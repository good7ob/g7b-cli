import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BeatResult, runLoop } from '../loop';
import { isPidAlive, liveEntries, readEntry, removeEntry, writeEntry } from '../state';
import { registerHeartbeatCommands } from '../index';
import { bizError, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { AgentStateStore } from '../../agent/state';

// os.homedir() is mocked, not $HOME: vitest workers keep a private process.env that libuv never sees
vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as typeof import('os');
  const homedir = () => (globalThis as { __hbTestHome?: string }).__hbTestHome ?? '/nonexistent-test-home';
  return { ...actual, default: { ...actual, homedir }, homedir };
});

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'good7ob-hb-'));
  (globalThis as { __hbTestHome?: string }).__hbTestHome = home;
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('runLoop', () => {
  const loop = (results: BeatResult[], aliveFor: number) => {
    let alive = aliveFor;
    const beats: BeatResult[] = [];
    const deps = {
      beat: async () => {
        const r = results.shift() ?? 'ok';
        beats.push(r);
        return r;
      },
      agentAlive: () => alive-- > 0,
      sleep: async () => {},
      intervalMs: 1,
    };
    return { run: () => runLoop(deps), beats };
  };

  it('beats while the agent lives, then ends with agent-gone', async () => {
    const l = loop([], 3);
    expect(await l.run()).toBe('agent-gone');
    expect(l.beats).toHaveLength(3);
  });

  it('keeps going through transient failures', async () => {
    const l = loop(['retry', 'retry', 'ok'], 3);
    expect(await l.run()).toBe('agent-gone');
    expect(l.beats).toEqual(['retry', 'retry', 'ok']);
  });

  it('stops at the first fatal answer', async () => {
    const l = loop(['ok', 'fatal', 'ok'], 10);
    expect(await l.run()).toBe('fatal');
    expect(l.beats).toEqual(['ok', 'fatal']);
  });

  it('never beats for an agent that is already gone', async () => {
    const l = loop([], 0);
    expect(await l.run()).toBe('agent-gone');
    expect(l.beats).toHaveLength(0);
  });
});

describe('loop state files', () => {
  it('round-trips an entry and removes it', () => {
    writeEntry({ agentPid: 11, loopPid: process.pid, startedAt: 'now' });
    expect(readEntry(11)?.loopPid).toBe(process.pid);
    removeEntry(11);
    expect(readEntry(11)).toBeNull();
  });

  it('liveEntries keeps live loops and prunes dead ones', () => {
    writeEntry({ agentPid: 21, loopPid: process.pid, startedAt: 'now' });
    writeEntry({ agentPid: 22, loopPid: 2 ** 22 - 1, startedAt: 'now' });
    expect(liveEntries().map((e) => e.agentPid)).toEqual([21]);
    expect(readEntry(22)).toBeNull();
  });

  it('isPidAlive rejects nonsense pids', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(NaN)).toBe(false);
  });
});

describe('heartbeat commands', () => {
  const hb = (args: string[], responder = ok(null) as ReturnType<typeof ok>) =>
    runCli(registerHeartbeatCommands, ['heartbeat', ...args], responder);

  it('beat posts to /api/v1/me/heartbeat', async () => {
    const run = await hb(['beat']);
    expect(run.exitCode).toBeUndefined();
    expect(run.http.post).toHaveBeenCalledWith('/api/v1/me/heartbeat', undefined);
  });

  it('beat fails loudly when the key is not an AI employee', async () => {
    const run = await hb(['beat'], bizError(500, '仅 AI 员工 Key 可上报心跳'));
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('仅 AI 员工');
  });

  it('start refuses (and starts no loop) when the key can never heartbeat', async () => {
    const run = await hb(['start', '--pid', String(process.pid)], bizError(500, '仅 AI 员工 Key 可上报心跳'));
    expect(run.exitCode).toBe(1);
    expect(readEntry(process.pid)).toBeNull();
  });

  it('start rejects a non-numeric --pid before any request', async () => {
    const run = await hb(['start', '--pid', 'abc']);
    expect(run.exitCode).toBe(1);
    expect(run.http.post).not.toHaveBeenCalled();
  });

  it('stop forgets the loop and marks the employee offline when it was the last one', async () => {
    writeEntry({ agentPid: 31, loopPid: 2 ** 22 - 1, startedAt: 'now' });
    const run = await hb(['stop', '--pid', '31']);
    expect(run.exitCode).toBeUndefined();
    expect(readEntry(31)).toBeNull();
    expect(run.http.delete).toHaveBeenCalledWith('/api/v1/me/heartbeat', undefined);
  });

  it('beat --runner-id/--slots/--env posts the runner fields and reports stopStepIds (prd-0136)', async () => {
    const run = await hb(['beat', '--runner-id', '12', '--slots', '2', '--env', 'dev,test'], ok({ stopStepIds: [345] }));
    expect(run.exitCode).toBeUndefined();
    expect(run.http.post).toHaveBeenCalledWith('/api/v1/me/heartbeat', { runnerId: 12, slots: 2, envTags: ['dev', 'test'] });
    expect(run.stdout).toContain('Runner #12');
    expect(run.stdout).toContain('后端要求停止步骤: 345');
  });

  it('beat --slots without --runner-id uses the registration agent listen left, else refuses', async () => {
    const refused = await hb(['beat', '--slots', '2']);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('--runner-id');
    expect(refused.http.post).not.toHaveBeenCalled();

    new AgentStateStore(path.join(home, '.good7ob')).writeRunner({ runnerId: 7, runnerKey: 'mbp', hostLabel: 'l', slots: 1, envTags: [], agentKind: 'CLAUDE_CODE', registeredAt: 'now' });
    const run = await hb(['beat', '--slots', '2', '--json']);
    expect(run.http.post).toHaveBeenCalledWith('/api/v1/me/heartbeat', { runnerId: 7, runnerKey: 'mbp', slots: 2 });
    expect(JSON.parse(run.stdout)).toEqual({ status: 'ok', runner: { runnerId: 7, runnerKey: 'mbp', slots: 2 }, stopStepIds: [] });
  });

  it('beat rejects bad runner flags before any request', async () => {
    const run = await hb(['beat', '--runner-id', '1', '--env', 'staging']);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain('staging');
    expect(run.http.post).not.toHaveBeenCalled();
  });

  it('status shows the runner each loop beats for', async () => {
    writeEntry({ agentPid: 51, loopPid: process.pid, startedAt: 'now', runner: { runnerId: 12, runnerKey: 'mbp', slots: 2, envTags: ['dev'] } });
    const run = await hb(['status']);
    expect(run.stdout).toContain('agent 51');
    expect(run.stdout).toContain('runner #12  slots 2  env dev');
    expect(JSON.parse((await hb(['status', '--json'])).stdout)[0].runner.runnerId).toBe(12);
  });

  it('stop of a runner loop takes that runner offline (query carries its identity) even while other loops run', async () => {
    writeEntry({ agentPid: 61, loopPid: process.pid, startedAt: 'now' });
    writeEntry({ agentPid: 62, loopPid: 2 ** 22 - 1, startedAt: 'now', runner: { runnerId: 12, runnerKey: 'mbp' } });
    const run = await hb(['stop', '--pid', '62']);
    expect(run.exitCode).toBeUndefined();
    expect(run.http.delete).toHaveBeenCalledWith('/api/v1/me/heartbeat?runnerKey=mbp&runnerId=12', undefined);
    expect(readEntry(61)).not.toBeNull();
  });

  it('stop keeps the employee online while another session of it still runs', async () => {
    writeEntry({ agentPid: 41, loopPid: process.pid, startedAt: 'now' });
    writeEntry({ agentPid: 42, loopPid: 2 ** 22 - 1, startedAt: 'now' });
    const run = await hb(['stop', '--pid', '42']);
    expect(run.http.delete).not.toHaveBeenCalled();
    expect(readEntry(41)).not.toBeNull();
  });
});
