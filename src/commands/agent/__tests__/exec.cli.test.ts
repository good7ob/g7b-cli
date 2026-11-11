import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAgentCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { fmtSeconds, resolveSessionId } from '../exec';
import { InputError } from '../../../utils/cliHelpers';

const SID = 'aaaaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const started = { taskId: 2857, subStatus: 'agent_executing', display: '杨健 · aaaaaaaaaa', startedAt: 1794306888213, lastBeatAt: 1794306888213, renewed: false, enforced: true };
// the exact body seen on dev: HTTP 200 + code 409
const held = { code: 409, msg: '任务 2857 正由 杨健 · aaaaaaaaaa 执行中', success: false, data: { holder: { display: '杨健 · aaaaaaaaaa', startedAt: 1794306888213 } } };

// Claude Code itself exports CLAUDE_CODE_SESSION_ID, so both variables are isolated for every test
const ENV_KEYS = ['G7B_SESSION_ID', 'CLAUDE_CODE_SESSION_ID'] as const;
const saved = ENV_KEYS.map((k) => process.env[k]);
const setSession = (v: string) => void (process.env.G7B_SESSION_ID = v);
beforeEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));
afterEach(() => {
  ENV_KEYS.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
  vi.restoreAllMocks();
});

describe('resolveSessionId', () => {
  it('prefers the option, falls back to G7B_SESSION_ID, blank means none', () => {
    expect(resolveSessionId(' abc ', { G7B_SESSION_ID: 'env' })).toBe('abc');
    expect(resolveSessionId(undefined, { G7B_SESSION_ID: 'env' })).toBe('env');
    expect(resolveSessionId('  ', {})).toBeUndefined();
    expect(resolveSessionId(undefined, { G7B_SESSION_ID: '' })).toBeUndefined();
  });
  it('order: --session > G7B_SESSION_ID > CLAUDE_CODE_SESSION_ID', () => {
    const both = { G7B_SESSION_ID: 'g7b', CLAUDE_CODE_SESSION_ID: 'claude' };
    expect(resolveSessionId('opt', both)).toBe('opt');
    expect(resolveSessionId(undefined, both)).toBe('g7b');
    expect(resolveSessionId(undefined, { CLAUDE_CODE_SESSION_ID: 'claude' })).toBe('claude');
    expect(resolveSessionId(undefined, { G7B_SESSION_ID: ' ', CLAUDE_CODE_SESSION_ID: 'claude' })).toBe('claude');
    expect(resolveSessionId(undefined, {})).toBeUndefined();
  });
  it('rejects a shape the backend would answer 1001 to', () => {
    expect(() => resolveSessionId('a b', {})).toThrow(InputError);
    expect(() => resolveSessionId('x'.repeat(129), {})).toThrow(InputError);
  });
});

describe('fmtSeconds', () => {
  it('renders seconds / minutes / hours', () => {
    expect(fmtSeconds(20)).toBe('20 秒');
    expect(fmtSeconds(65)).toBe('1 分 5 秒');
    expect(fmtSeconds(3700)).toBe('1 小时 1 分 40 秒');
    expect(fmtSeconds(null)).toBe('—');
  });
});

describe('good7ob agent start', () => {
  it('posts {sessionId} to agent-exec/start and prints the holder', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'start', '2857', '--session', SID], ok(started));
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/2857/agent-exec/start', { sessionId: SID });
    expect(r.stdout).toContain('任务 #2857 已开始执行');
    expect(r.stdout).toContain('杨健 · aaaaaaaaaa');
  });

  it('reads G7B_SESSION_ID when --session is absent', async () => {
    setSession(SID);
    const r = await runCli(registerAgentCommands, ['agent', 'start', '2857'], ok(started));
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/2857/agent-exec/start', { sessionId: SID });
  });

  it('--session wins over the environment', async () => {
    setSession('from-env');
    const r = await runCli(registerAgentCommands, ['agent', 'start', '2857', '--session', 'from-opt'], ok(started));
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/2857/agent-exec/start', { sessionId: 'from-opt' });
  });

  it('errors out without any request when no session id is available', async () => {
    setSession('');
    const r = await runCli(registerAgentCommands, ['agent', 'start', '2857'], ok(started));
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
    expect(r.stderr).toContain('G7B_SESSION_ID');
  });

  it('falls back to CLAUDE_CODE_SESSION_ID as the third level', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = SID;
    const r = await runCli(registerAgentCommands, ['agent', 'start', '2857'], ok(started));
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/2857/agent-exec/start', { sessionId: SID });
  });

  it('rejects a bad task id without a request', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'start', 'abc', '--session', SID], ok(started));
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('says renewed when the same session starts again', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'start', '2857', '--session', SID], ok({ ...started, renewed: true }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('续期');
  });

  it('--json prints the response data untouched', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'start', '2857', '--session', SID, '--json'], ok(started));
    expect(JSON.parse(r.stdout)).toEqual(started);
  });

  it('a 409 carried in an HTTP 200 body exits 3 and shows who holds the task', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'start', '2857', '--session', SID], held);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('任务 2857 正由 杨健 · aaaaaaaaaa 执行中');
    expect(r.stderr).toContain('2026-');
  });

  it('a 409 with --json prints status/holder on stdout and exits 3', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'start', '2857', '--session', SID, '--json'], held);
    expect(r.exitCode).toBe(3);
    expect(JSON.parse(r.stdout)).toEqual({ status: 'conflict', message: held.msg, holder: held.data.holder });
  });

  it('switch off (enforced:false) is a notice, not a failure', async () => {
    const off = { taskId: 2857, subStatus: null, display: null, startedAt: 1794306888213, lastBeatAt: 1794306888213, renewed: false, enforced: false };
    const r = await runCli(registerAgentCommands, ['agent', 'start', '2857', '--session', SID], ok(off));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('未启用');
  });

  it('other business errors (1001 wrong status) exit 1 with the server message', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'start', '2857', '--session', SID], bizError(1001, '任务 2857 当前状态不是 in_progress，不能开始执行'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('不是 in_progress');
  });
});

describe('good7ob agent end', () => {
  const ended = { taskId: 2857, endReason: 'END', durationSeconds: 20, agentExecSeconds: 65 };

  it('posts {sessionId} only by default', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'end', '2857', '--session', SID], ok(ended));
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/2857/agent-exec/end', { sessionId: SID });
    expect(r.stdout).toContain('已结束执行');
    expect(r.stdout).toContain('20 秒');
    expect(r.stdout).toContain('1 分 5 秒');
  });

  it('sends {} when no session is known and --force adds force:true', async () => {
    setSession('');
    const a = await runCli(registerAgentCommands, ['agent', 'end', '2857'], ok(ended));
    expect(a.http.post).toHaveBeenCalledWith('/progress/tasks/2857/agent-exec/end', {});
    const b = await runCli(registerAgentCommands, ['agent', 'end', '2857', '--force'], ok({ ...ended, endReason: 'FORCE' }));
    expect(b.http.post).toHaveBeenCalledWith('/progress/tasks/2857/agent-exec/end', { force: true });
    expect(b.stdout).toContain('强制');
  });

  it('falls back to G7B_SESSION_ID', async () => {
    setSession(SID);
    const r = await runCli(registerAgentCommands, ['agent', 'end', '2857'], ok(ended));
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/2857/agent-exec/end', { sessionId: SID });
  });

  it('nothing held (endReason null) is success, exit 0', async () => {
    const none = { taskId: 2857, endReason: null, durationSeconds: null, agentExecSeconds: null };
    const r = await runCli(registerAgentCommands, ['agent', 'end', '2857', '--session', SID], ok(none));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('没有执行占用');
    const j = await runCli(registerAgentCommands, ['agent', 'end', '2857', '--session', SID, '--json'], ok(none));
    expect(JSON.parse(j.stdout)).toEqual(none);
  });

  it('409 (somebody else holds it) exits 3 and hints --force', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'end', '2857', '--session', SID], held);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('杨健 · aaaaaaaaaa');
    expect(r.stderr).toContain('--force');
  });

  it('403 on --force exits 1 with the server message', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'end', '2857', '--force'], bizError(403, '仅任务负责人或项目管理员可强制释放'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('仅任务负责人或项目管理员可强制释放');
  });
});
