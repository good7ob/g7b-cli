/** prd-0187 FP-7 (g7b #2839): `pm task create` run context headers, links and the three spawn results. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerTaskCommands } from '../index';
import { describeSpawnContextError, linkFields, renderSpawnResult, runContextHeaders } from '../spawn';
import { AgentState, AgentStateStore, IDLE } from '../../../agent/state';
import { httpError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerTaskCommands(program.command('pm'));
const busy = (extra: object = {}): AgentState =>
  ({ status: 'busy', taskId: 9, taskNo: null, name: 'x', projectId: 4, claimedAt: '', deadline: '', ...extra } as AgentState);

/** Pins what `agent listen` holds, so no test reads the real ~/.good7ob state file. */
const slot = (state: AgentState | Error) =>
  vi.spyOn(AgentStateStore.prototype, 'read').mockImplementation(() => {
    if (state instanceof Error) throw state;
    return state;
  });

const create = (args: string[], response = ok({ id: 55, name: 'Child' })) =>
  runCli(register, ['pm', 'task', 'create', '--project-id', '4', '--name', 'Child', ...args], response);

afterEach(() => vi.restoreAllMocks());

describe('runContextHeaders', () => {
  const idle = () => IDLE;
  it('builds both headers from --run-id / --step-id', () =>
    expect(runContextHeaders({ runId: '7', stepId: '31' }, idle)).toEqual({ 'X-Automation-Run-Id': '7', 'X-Automation-Step-Id': '31' }));
  it('needs both flags together', () => {
    expect(() => runContextHeaders({ runId: '7' }, idle)).toThrow('同时给出');
    expect(() => runContextHeaders({ stepId: '31' }, idle)).toThrow('同时给出');
  });
  it.each([['abc', '3'], ['0', '3'], ['7', '-1']])('rejects non-numeric / non-positive ids %s %s', (r, st) =>
    expect(() => runContextHeaders({ runId: r, stepId: st }, idle)).toThrow(/--(run|step)-id/));
  it('falls back to the step agent listen is working on', () =>
    expect(runContextHeaders({}, () => busy({ runId: 7, stepId: 31 }))).toEqual({ 'X-Automation-Run-Id': '7', 'X-Automation-Step-Id': '31' }));
  it('also while the slot is in timeout', () =>
    expect(runContextHeaders({}, () => busy({ status: 'timeout', runId: 7, stepId: 31 }))).toBeDefined());
  it('sends nothing when idle', () => expect(runContextHeaders({}, idle)).toBeUndefined());
  it('sends nothing when the slot holds a plain task (no run / step)', () => {
    expect(runContextHeaders({}, () => busy())).toBeUndefined();
    expect(runContextHeaders({}, () => busy({ runId: 7 }))).toBeUndefined();
  });
  it('explicit flags win over the slot', () =>
    expect(runContextHeaders({ runId: '8', stepId: '2' }, () => busy({ runId: 7, stepId: 31 }))).toEqual({
      'X-Automation-Run-Id': '8', 'X-Automation-Step-Id': '2',
    }));
  it('--no-run-context skips the slot and conflicts with explicit ids', () => {
    const read = vi.fn(() => busy({ runId: 7, stepId: 31 }));
    expect(runContextHeaders({ runContext: false }, read)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(() => runContextHeaders({ runContext: false, runId: '1', stepId: '2' }, read)).toThrow('--no-run-context');
  });
  it('a corrupt state file warns and sends nothing', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(runContextHeaders({}, () => { throw new Error('损坏'); })).toBeUndefined();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('损坏'));
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

  it('takes the run context from the agent slot when the flags are absent', async () => {
    slot(busy({ runId: 7, stepId: 31 }));
    const r = await create([], ok({ id: 55, spawnResult: 'CREATED' }));
    expect(r.http.post.mock.calls[0][2].headers).toEqual({ 'X-Automation-Run-Id': '7', 'X-Automation-Step-Id': '31' });
  });

  it('stays as before when idle: no headers, old output', async () => {
    slot(IDLE);
    const r = await create([]);
    expect(r.http.post.mock.calls[0]).toHaveLength(2);
    expect(r.http.post.mock.calls[0][1]).not.toHaveProperty('functionPointId');
    expect(r.stdout).toContain('✓ 任务已创建: [55] Child');
  });

  it('--no-run-context ignores a busy slot', async () => {
    slot(busy({ runId: 7, stepId: 31 }));
    const r = await create(['--no-run-context']);
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
