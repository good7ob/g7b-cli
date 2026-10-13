import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BeatResult, runLoop } from '../loop';
import { isPidAlive, liveEntries, readEntry, removeEntry, writeEntry } from '../state';
import { registerHeartbeatCommands } from '../index';
import { bizError, ok, runCli } from '../../../utils/__tests__/cliHarness';

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

  it('stop keeps the employee online while another session of it still runs', async () => {
    writeEntry({ agentPid: 41, loopPid: process.pid, startedAt: 'now' });
    writeEntry({ agentPid: 42, loopPid: 2 ** 22 - 1, startedAt: 'now' });
    const run = await hb(['stop', '--pid', '42']);
    expect(run.http.delete).not.toHaveBeenCalled();
    expect(readEntry(41)).not.toBeNull();
  });
});
