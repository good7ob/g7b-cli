import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerAgentCommands } from '../index';
import { bizError, ok, runCli } from '../../../utils/__tests__/cliHarness';
import configService from '../../../services/ConfigService';
import { AgentStateStore, busyState } from '../state';

// os.homedir() is mocked, not $HOME: vitest workers keep a private process.env that libuv never sees, so a
// $HOME override would let these tests write the real ~/.good7ob/agent-state.json.
vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as typeof import('os');
  const homedir = () => (globalThis as { __agentTestHome?: string }).__agentTestHome ?? '/nonexistent-test-home';
  return { ...actual, default: { ...actual, homedir }, homedir };
});

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cli-'));
  (globalThis as { __agentTestHome?: string }).__agentTestHome = tmpHome;
});
afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('good7ob agent next', () => {
  it('skips a business-code 409 claim and exits 4 when nothing is left', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'next'], (m, url) =>
      m === 'get' ? ok([{ id: 1 }]) : bizError(409, '任务已被领取')
    );
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/1/claim', undefined);
    expect(r.exitCode).toBe(4);
    expect(new AgentStateStore(path.join(tmpHome, '.good7ob')).read()).toEqual({ status: 'idle' });
  });

  it('claims, then reports busy with exit 3 on the next call', async () => {
    const task = { id: 3, taskNo: 'T3', name: 'n', status: 'in_progress', estimatedHours: null };
    const first = await runCli(registerAgentCommands, ['agent', 'next', '--json'], (m) =>
      m === 'get' ? ok([{ id: 3 }]) : ok(task)
    );
    expect(first.exitCode).toBeUndefined();
    expect(JSON.parse(first.stdout).slot).toMatchObject({ status: 'busy', taskId: 3 });
    const second = await runCli(registerAgentCommands, ['agent', 'next'], ok(task));
    expect(second.exitCode).toBe(3);
  });
});

describe('good7ob agent next (registered runner)', () => {
  const runner = { runnerId: 12, runnerKey: 'mbp', hostLabel: 'mbp:good7ob', slots: 1, envTags: [], agentKind: 'CLAUDE_CODE', registeredAt: 'now' };
  const assigned = { id: 11, taskNo: 'T11', name: 'dev step', assignmentId: 9, runId: 3, stepId: 45, nodeCode: 'DEV', requiredJob: 'DEV', nodePrompt: '实现并提交 PR' };

  it('polls with ?runnerId=, claims with ?runnerId= and prints the assigned-item context', async () => {
    new AgentStateStore(path.join(tmpHome, '.good7ob')).writeRunner(runner);
    const r = await runCli(registerAgentCommands, ['agent', 'next'], (m) => (m === 'get' ? ok([assigned]) : ok({ id: 11, status: 'in_progress' })));
    expect(r.exitCode).toBeUndefined();
    expect(r.http.get).toHaveBeenCalledWith('/progress/agent-tasks', expect.objectContaining({ params: { runnerId: 12 } }));
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/11/claim?runnerId=12', undefined);
    expect(r.stdout).toContain('分配 #9  运行 #3  步骤 #45  节点 DEV（岗位 DEV）');
    expect(r.stdout).toContain('节点提示: 实现并提交 PR');
    expect(r.stdout).toContain('分配: #9  运行: #3  步骤: #45  节点: DEV');
  });

  it('--json carries slot, task (with node brief) and runner', async () => {
    new AgentStateStore(path.join(tmpHome, '.good7ob')).writeRunner(runner);
    const r = await runCli(registerAgentCommands, ['agent', 'next', '--json'], (m) => (m === 'get' ? ok([assigned]) : ok({ id: 11, status: 'in_progress' })));
    const out = JSON.parse(r.stdout);
    expect(out.slot).toMatchObject({ taskId: 11, assignmentId: 9, stepId: 45, nodeCode: 'DEV' });
    expect(out.task.nodePrompt).toBe('实现并提交 PR');
    expect(out.runner.runnerId).toBe(12);
  });

  it('exits 5 with a clear message when the only items are assigned to another runner (409)', async () => {
    new AgentStateStore(path.join(tmpHome, '.good7ob')).writeRunner(runner);
    const r = await runCli(registerAgentCommands, ['agent', 'next'], (m) =>
      m === 'get' ? ok([assigned]) : bizError(409, 'ASSIGNED_TO_OTHER: 任务 11 已分配给同一员工的另一台 Runner #3')
    );
    expect(r.exitCode).toBe(5);
    expect(r.stdout).toContain('已分配给其他 Runner（409）');
    expect(r.stderr).toContain('ASSIGNED_TO_OTHER');
  });
});

describe('good7ob agent listen --once', () => {
  const calls = (r: Awaited<ReturnType<typeof runCli>>) =>
    (['post', 'get', 'delete'] as const).flatMap((m) => r.http[m].mock.calls.map((c) => `${m} ${c[0]}`));

  beforeEach(() => {
    // the singleton was built against the mocked (nonexistent) home: keep the config in memory only
    vi.spyOn(configService, 'saveConfig').mockImplementation(() => undefined);
    configService.set('agent', { forward: { command: 'true' }, envTags: ['test'] });
  });
  afterEach(() => configService.set('agent', undefined));

  it('registers the runner, beats, polls assigned-first, persists runnerId and goes offline on exit', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'listen', '--once', '--slots', '2', '--env', 'dev', '--host-id', 'mbp'], (m, url) => {
      if (m === 'post' && url === '/api/v1/me/runners') return ok({ id: 12, hostKey: 'mbp', slots: 2, envTags: ['dev'], agentKind: 'CLAUDE_CODE', status: 'online' });
      if (m === 'post' && url === '/api/v1/me/heartbeat') return ok({ stopStepIds: [] });
      return ok([]);
    });
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post).toHaveBeenCalledWith('/api/v1/me/runners', {
      runnerKey: 'mbp',
      hostLabel: `${os.hostname()}:${path.basename(process.cwd())}`,
      agentKind: 'CLAUDE_CODE',
      slots: 2,
      envTags: ['dev'],
    });
    expect(r.http.post).toHaveBeenCalledWith('/api/v1/me/heartbeat', { runnerId: 12, runnerKey: 'mbp' });
    expect(r.http.get).toHaveBeenCalledWith('/progress/agent-tasks', expect.objectContaining({ params: { runnerId: 12 } }));
    expect(r.http.delete).toHaveBeenCalledWith('/api/v1/me/heartbeat?runnerKey=mbp&runnerId=12', undefined);
    expect(new AgentStateStore(path.join(tmpHome, '.good7ob')).readRunner()).toMatchObject({ runnerId: 12, runnerKey: 'mbp', slots: 2, envTags: ['dev'] });
    expect(r.stdout).toContain('Runner 已注册: #12');
    expect(r.stdout).toContain('slots=2 只用于向调度器申报容量');
  });

  it('config supplies the defaults (agent.envTags) when no flag is given', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'listen', '--once'], (m, url) =>
      m === 'post' && url === '/api/v1/me/runners' ? ok({ id: 3 }) : ok([])
    );
    expect(r.http.post).toHaveBeenCalledWith('/api/v1/me/runners', expect.objectContaining({ slots: 1, envTags: ['test'], runnerKey: os.hostname() }));
  });

  it('a human key is refused before any heartbeat or polling (rp-auto-sched-0009)', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'listen', '--once'], (m, url) =>
      m === 'post' && url === '/api/v1/me/runners' ? bizError(403, '仅 AI 员工 Key 可注册 Runner') : ok([])
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('仅 AI 员工 Key 可注册 Runner');
    expect(calls(r)).toEqual(['post /api/v1/me/runners']);
    expect(new AgentStateStore(path.join(tmpHome, '.good7ob')).readRunner()).toBeNull();
  });

  it('stopStepIds from the heartbeat marks the matching local step and is reported', async () => {
    const store = new AgentStateStore(path.join(tmpHome, '.good7ob'));
    store.write({ ...busyState({ id: 11, stepId: 45 } as any, Date.now(), 60) });
    const r = await runCli(registerAgentCommands, ['agent', 'listen', '--once'], (m, url) => {
      if (m === 'post' && url === '/api/v1/me/runners') return ok({ id: 12 });
      if (m === 'post' && url === '/api/v1/me/heartbeat') return ok({ stopStepIds: [45] });
      return ok({ status: 'in_progress' });
    });
    expect(r.stdout).toContain('后端要求停止步骤: 45');
    expect(r.stdout).toContain('步骤 #45）已标记停止');
    expect(store.read()).toMatchObject({ status: 'busy', taskId: 11, stopRequestedAt: expect.any(String) });
  });

  it('rejects bad flags before any request', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'listen', '--once', '--slots', '9']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--slots');
    expect(calls(r)).toEqual([]);
  });
});

describe('good7ob agent status / reset', () => {
  const runner = { runnerId: 12, runnerKey: 'mbp', hostLabel: 'mbp:good7ob', slots: 2, envTags: ['dev'], agentKind: 'CLAUDE_CODE', registeredAt: '2026-10-29T00:00:00.000Z' };

  it('status shows the registration, reset clears it unless --keep-runner', async () => {
    const store = new AgentStateStore(path.join(tmpHome, '.good7ob'));
    store.writeRunner(runner);
    const s = await runCli(registerAgentCommands, ['agent', 'status']);
    expect(s.stdout).toContain('Runner: Runner #12  mbp:good7ob（hostId mbp）');
    expect(s.stdout).toContain('slots: 2  env: dev  agentKind: CLAUDE_CODE');
    const j = await runCli(registerAgentCommands, ['agent', 'status', '--json']);
    expect(JSON.parse(j.stdout).runner).toEqual(runner);

    const keep = await runCli(registerAgentCommands, ['agent', 'reset', '--keep-runner']);
    expect(keep.exitCode).toBeUndefined();
    expect(store.readRunner()).toEqual(runner);
    const r = await runCli(registerAgentCommands, ['agent', 'reset']);
    expect(r.stdout).toContain('Runner 注册记录已清除');
    expect(store.readRunner()).toBeNull();
    expect((await runCli(registerAgentCommands, ['agent', 'status'])).stdout).toContain('Runner: 未注册');
  });
});

describe('good7ob agent done', () => {
  it('surfaces the backend state-machine error verbatim', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'done', '3'], bizError(400, '需先进入 awaiting_completion_approval'));
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/3', { status: 'completed' });
    expect(r.stderr).toContain('需先进入 awaiting_completion_approval');
    expect(r.exitCode).toBe(1);
  });
});
