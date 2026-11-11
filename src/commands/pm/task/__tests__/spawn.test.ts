/** prd-0187 FP-7 (g7b #2839): `pm task create` run context headers, links and the three spawn results. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerTaskCommands } from '../index';
import { describeSpawnContextError, isLoopRun, linkFields, renderSpawnResult, runContextHeaders } from '../spawn';
import apiClient from '../../../../services/ApiClient';
import { AgentState, AgentStateStore, IDLE } from '../../../agent/state';
import { Envelope, bizError, httpError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerTaskCommands(program.command('pm'));
const busy = (extra: object = {}): AgentState =>
  ({ status: 'busy', taskId: 9, taskNo: null, name: 'x', projectId: 4, claimedAt: '', deadline: '', ...extra } as AgentState);

/** Pins what `agent listen` holds, so no test reads the real ~/.good7ob state file. */
const slot = (state: AgentState | Error) =>
  vi.spyOn(AgentStateStore.prototype, 'read').mockImplementation(() => {
    if (state instanceof Error) throw state;
    return state;
  });

/** Answers `GET …/runs/<id>` with `run`, everything else (the create) with `created`. */
const respond = (created: Envelope, run: Envelope = ok({ id: 7, loop: null })) => (m: string, url: string) =>
  m === 'get' && url.includes('/runs/') ? run : created;

const create = (args: string[], response: Envelope | ((m: string, url: string) => Envelope) = ok({ id: 55, name: 'Child' })) =>
  runCli(register, ['pm', 'task', 'create', '--project-id', '4', '--name', 'Child', ...args], response as never);

afterEach(() => vi.restoreAllMocks());

describe('runContextHeaders', () => {
  const idle = () => IDLE;
  const HEADERS = { 'X-Automation-Run-Id': '7', 'X-Automation-Step-Id': '31' };
  const loopYes = vi.fn(async () => true);
  const loopNo = vi.fn(async () => false);
  beforeEach(() => {
    loopYes.mockClear();
    loopNo.mockClear();
  });

  it('builds both headers from --run-id / --step-id without any lookup', async () => {
    expect(await runContextHeaders({ runId: '7', stepId: '31' }, idle, loopNo)).toEqual(HEADERS);
    expect(loopNo).not.toHaveBeenCalled();
  });
  it('needs both flags together', async () => {
    await expect(runContextHeaders({ runId: '7' }, idle)).rejects.toThrow('同时给出');
    await expect(runContextHeaders({ stepId: '31' }, idle)).rejects.toThrow('同时给出');
  });
  it.each([['abc', '3'], ['0', '3'], ['7', '-1']])('rejects non-numeric / non-positive ids %s %s', async (r, st) => {
    await expect(runContextHeaders({ runId: r, stepId: st }, idle)).rejects.toThrow(/--(run|step)-id/);
  });
  it('slot step of a long run: sends the headers (and looked up that run)', async () => {
    expect(await runContextHeaders({}, () => busy({ runId: 7, stepId: 31, orgId: 3 }), loopYes)).toEqual(HEADERS);
    expect(loopYes).toHaveBeenCalledWith({ runId: 7, stepId: 31, orgId: 3 });
  });
  it('also while the slot is in timeout', async () =>
    expect(await runContextHeaders({}, () => busy({ status: 'timeout', runId: 7, stepId: 31 }), loopYes)).toEqual(HEADERS));
  it('slot step of an ordinary run (no loop): sends nothing', async () =>
    expect(await runContextHeaders({}, () => busy({ runId: 7, stepId: 31 }), loopNo)).toBeUndefined());
  it('a failed lookup sends nothing, warns once and does not throw', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const headers = await runContextHeaders({}, () => busy({ runId: 7, stepId: 31 }), async () => { throw new Error('Network Error'); });
    expect(headers).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('查询运行 #7 失败'));
  });
  it('sends nothing, and looks nothing up, when idle or the slot holds a plain task', async () => {
    expect(await runContextHeaders({}, idle, loopYes)).toBeUndefined();
    expect(await runContextHeaders({}, () => busy(), loopYes)).toBeUndefined();
    expect(await runContextHeaders({}, () => busy({ runId: 7 }), loopYes)).toBeUndefined();
    expect(loopYes).not.toHaveBeenCalled();
  });
  it('explicit flags win over the slot and skip the lookup', async () => {
    expect(await runContextHeaders({ runId: '8', stepId: '2' }, () => busy({ runId: 7, stepId: 31 }), loopNo)).toEqual({
      'X-Automation-Run-Id': '8', 'X-Automation-Step-Id': '2',
    });
    expect(loopNo).not.toHaveBeenCalled();
  });
  it('--no-run-context skips the slot and the lookup, and conflicts with explicit ids', async () => {
    const read = vi.fn(() => busy({ runId: 7, stepId: 31 }));
    expect(await runContextHeaders({ runContext: false }, read, loopYes)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(loopYes).not.toHaveBeenCalled();
    await expect(runContextHeaders({ runContext: false, runId: '1', stepId: '2' }, read)).rejects.toThrow('--no-run-context');
  });
  it('a corrupt state file warns and sends nothing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runContextHeaders({}, () => { throw new Error('损坏'); }, loopYes)).toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('损坏'));
    expect(loopYes).not.toHaveBeenCalled();
  });
});

describe('linkFields', () => {
  it('maps --fp-id / --rp-id to the body fields', () =>
    expect(linkFields({ fpId: '12', rpId: '34' })).toEqual({ functionPointId: 12, rulePointId: 34 }));
  it('sends nothing without flags', () => expect(linkFields({})).toEqual({}));
  it('rejects a bad id', () => expect(() => linkFields({ fpId: 'x' })).toThrow('--fp-id'));
});

describe('renderSpawnResult', () => {
  it('CREATED', () => expect(renderSpawnResult({ spawnResult: 'CREATED', id: 5 }, 'T')).toContain('已创建任务 #5'));
  it('DEDUPED', () => expect(renderSpawnResult({ spawnResult: 'DEDUPED', id: 6, name: 'T' }, 'T')).toContain('已存在任务 #6（去重）'));
  it('DRAFTED', () => {
    const text = renderSpawnResult({ spawnResult: 'DRAFTED', draftId: 8, reason: 'QUOTA', draftExisted: false }, 'T');
    expect(text).toContain('已提交草案 #8（原因：QUOTA）');
    expect(text).not.toContain('同键草案已存在');
  });
  it('DRAFTED with an existing same-key draft', () =>
    expect(renderSpawnResult({ spawnResult: 'DRAFTED', draftId: 8, reason: 'POLICY', draftExisted: true }, 'T')).toContain('同键草案已存在'));
  it('no spawnResult = old output', () => {
    expect(renderSpawnResult({ id: 5 }, 'T')).toBeUndefined();
    expect(renderSpawnResult(undefined, 'T')).toBeUndefined();
  });
});

describe('describeSpawnContextError', () => {
  it('recognises the string code and the message prefix', () => {
    expect(describeSpawnContextError({ code: 'SPAWN_CONTEXT_INVALID', message: 'SPAWN_CONTEXT_INVALID: 步骤 #200 当前不由本 AI 员工持有' }))
      .toContain('步骤 #200 当前不由本 AI 员工持有');
    expect(describeSpawnContextError({ message: 'SPAWN_CONTEXT_INVALID: x' })).toBeDefined();
  });
  it('ignores other errors', () => expect(describeSpawnContextError(new Error('boom'))).toBeUndefined());
});

describe('pm task create (CLI)', () => {
  it('sends the headers and body links, not the ids in the body', async () => {
    slot(IDLE);
    const r = await create(['--run-id', '7', '--step-id', '31', '--fp-id', '12', '--rp-id', '34'], ok({ id: 55, spawnResult: 'CREATED' }));
    expect(r.exitCode).toBeUndefined();
    const [url, body, config] = r.http.post.mock.calls[0];
    expect(url).toBe('/progress/tasks');
    expect(body).toEqual(expect.objectContaining({ functionPointId: 12, rulePointId: 34 }));
    expect(body).not.toHaveProperty('runId');
    expect(body).not.toHaveProperty('stepId');
    expect(config.headers).toEqual({ 'X-Automation-Run-Id': '7', 'X-Automation-Step-Id': '31' });
    expect(r.stdout).toContain('已创建任务 #55');
  });

  it('slot step of a long run: looks the run up in the step org and sends the headers', async () => {
    slot(busy({ runId: 7, stepId: 31, orgId: 3 }));
    const r = await create([], respond(ok({ id: 55, spawnResult: 'CREATED' }), ok({ id: 7, loop: { phase: 'ACCEPTING' } })));
    expect(r.http.get.mock.calls[0][0]).toBe('/api/v1/orgs/3/runs/7');
    expect(r.http.post.mock.calls[0][2].headers).toEqual({ 'X-Automation-Run-Id': '7', 'X-Automation-Step-Id': '31' });
  });

  it('slot step of an ordinary run (loop null): no headers, old output', async () => {
    slot(busy({ runId: 7, stepId: 31, orgId: 3 }));
    const r = await create([], respond(ok({ id: 55, name: 'Child' })));
    expect(r.http.get).toHaveBeenCalledTimes(1);
    expect(r.http.post.mock.calls[0]).toHaveLength(2);
    expect(r.stdout).toContain('✓ 任务已创建: [55] Child');
  });

  it('a failed run lookup (404 / no permission) still creates the task, without headers, with a warning', async () => {
    slot(busy({ runId: 7, stepId: 31, orgId: 3 }));
    const r = await create([], respond(ok({ id: 55, name: 'Child' }), bizError(1002, '运行不存在') as Envelope));
    expect(r.exitCode).toBeUndefined();
    expect(r.stderr).toContain('查询运行 #7 失败');
    expect(r.http.post.mock.calls[0]).toHaveLength(2);
    expect(r.stdout).toContain('任务已创建');
  });

  it('explicit --run-id / --step-id never query the run', async () => {
    slot(busy({ runId: 7, stepId: 31, orgId: 3 }));
    const r = await create(['--run-id', '8', '--step-id', '2'], respond(ok({ id: 55, spawnResult: 'CREATED' })));
    expect(r.http.get).not.toHaveBeenCalled();
    expect(r.http.post.mock.calls[0][2].headers).toEqual({ 'X-Automation-Run-Id': '8', 'X-Automation-Step-Id': '2' });
  });

  it('stays as before when idle: no headers, old output', async () => {
    slot(IDLE);
    const r = await create([]);
    expect(r.http.post.mock.calls[0]).toHaveLength(2);
    expect(r.http.post.mock.calls[0][1]).not.toHaveProperty('functionPointId');
    expect(r.stdout).toContain('✓ 任务已创建: [55] Child');
  });

  it('--no-run-context ignores a busy slot', async () => {
    slot(busy({ runId: 7, stepId: 31, orgId: 3 }));
    const r = await create(['--no-run-context']);
    expect(r.http.get).not.toHaveBeenCalled();
    expect(r.http.post.mock.calls[0]).toHaveLength(2);
  });

  it('prints DEDUPED with exit code 0', async () => {
    slot(IDLE);
    const r = await create([], ok({ id: 41, name: 'Child', spawnResult: 'DEDUPED' }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('已存在任务 #41（去重）');
  });

  it('prints DRAFTED (no task id in the answer) with exit code 0', async () => {
    slot(IDLE);
    const r = await create([], ok({ spawnResult: 'DRAFTED', draftId: 9, reason: 'NO_LINK', draftExisted: true, runId: 7, stepId: 31 }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('已提交草案 #9（原因：NO_LINK）');
    expect(r.stdout).toContain('同键草案已存在');
  });

  it('--json prints the response data untouched', async () => {
    slot(IDLE);
    const data = { spawnResult: 'DRAFTED', draftId: 9, reason: 'QUOTA', draftExisted: false };
    const r = await create(['--json'], ok(data));
    expect(JSON.parse(r.stdout)).toEqual(data);
  });

  it('409 SPAWN_CONTEXT_INVALID is an error with a clear message and a non-zero exit', async () => {
    slot(IDLE);
    const body = { code: 'SPAWN_CONTEXT_INVALID', success: false, msg: 'SPAWN_CONTEXT_INVALID: 步骤 #200 当前不由本 AI 员工持有' };
    const r = await create(['--run-id', '7', '--step-id', '200'], httpError(409, body));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('运行上下文无效');
    expect(r.stderr).toContain('步骤 #200 当前不由本 AI 员工持有');
    expect(r.stdout).not.toContain('已创建');
  });

  it('refuses a lone --run-id without calling the API', async () => {
    slot(IDLE);
    const r = await create(['--run-id', '7']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('同时给出');
    expect(noHttpCalls(r)).toBe(true);
  });

  it('a corrupt state file does not block creating the task', async () => {
    slot(new Error('agent 状态文件损坏'));
    const r = await create([]);
    expect(r.exitCode).toBeUndefined();
    expect(r.stderr).toContain('损坏');
    expect(r.http.post.mock.calls[0]).toHaveLength(2);
  });
});

describe('isLoopRun', () => {
  const answer = (data: unknown) => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue(data);
    return isLoopRun({ runId: 7, stepId: 31, orgId: 3 }).then((v) => ({ v, url: get.mock.calls[0][0] }));
  };
  it('is true only when the run detail carries a loop object', async () => {
    expect(await answer({ id: 7, loop: { phase: 'DRAINING' } })).toEqual({ v: true, url: '/api/v1/orgs/3/runs/7' });
    expect((await answer({ id: 7, loop: null })).v).toBe(false);
    expect((await answer({ id: 7 })).v).toBe(false);
  });
});
