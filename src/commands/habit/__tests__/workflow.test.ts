import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Envelope, bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { registerHabitCommands } from '../index';
import { readWorkflowFile, toSteps } from '../input';

afterEach(() => vi.restoreAllMocks());

const W = '/api/v1/me/work-workflows';
const wf = (over: Record<string, unknown> = {}) => ({
  id: 7, name: '我的任务流程', description: '说明', scene: 'SINGLE_TASK', status: 'ENABLED', isDefault: false, version: 2, stepCount: 2,
  updatedAt: 1760832000000,
  steps: [
    { id: 31, seq: 1, title: '读懂任务', description: '看验收标准', habits: [{ id: 101, title: '一主题一分支一 PR' }] },
    { id: 32, seq: 2, title: '实现', description: '', habits: [] },
  ], ...over,
});
const cli = (args: string[], res: any = ok(null)) => runCli(registerHabitCommands, ['habit', 'workflow', ...args], res);
const lastBody = (fn: any) => fn.mock.calls[fn.mock.calls.length - 1][1];
const tmpFile = (name: string, content: string) => {
  const f = join(mkdtempSync(join(tmpdir(), 'wf-')), name);
  writeFileSync(f, content);
  return f;
};
const getThen = (after: unknown): ((m: string) => Envelope) => (m) => (m === 'get' ? ok(wf()) : ok(after));

async function rejects(args: string[], needle: string) {
  const r = await cli(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('workflow list / show', () => {
  it('maps scene to the API enum and renders groups', async () => {
    const r = await cli(['list', '--scene', 'task', '--status', 'enabled'], ok({ total: 1, groups: [{ scene: 'SINGLE_TASK', items: [wf({ steps: undefined })] }] }));
    expect(r.http.get).toHaveBeenCalledWith(W, { params: { scene: 'SINGLE_TASK', status: 'ENABLED' } });
    expect(r.stdout).toContain('我的任务流程');
    expect(r.stdout).toContain('2 步');
    expect(r.stdout).toContain('2025-10-19 09:20:00'.slice(0, 4));
  });
  it('time is shown in JST (1760832000000 = 2025-10-19 08:00 UTC -> 17:00 JST)', async () => {
    const r = await cli(['show', '7'], ok(wf()));
    expect(r.stdout).toContain('2025-10-19 09:00:00');
  });
  it('--json passes data through; show renders steps and linked habits', async () => {
    expect(JSON.parse((await cli(['show', '7', '--json'], ok(wf()))).stdout).id).toBe(7);
    const r = await cli(['show', '7'], ok(wf()));
    expect(r.http.get).toHaveBeenCalledWith(`${W}/7`, { params: undefined });
    expect(r.stdout).toContain('1. 读懂任务：看验收标准');
    expect(r.stdout).toContain('关联习惯：一主题一分支一 PR');
  });
  it('rejects bad scene / status / id', async () => {
    await rejects(['list', '--scene', 'weekly'], '--scene');
    await rejects(['list', '--status', 'DRAFT'], '--status');
    await rejects(['show', '0'], 'id');
  });
});

describe('workflow add', () => {
  it('builds the body from --step flags (titles only, in order)', async () => {
    const r = await cli(['add', '--name', '每日开工', '--scene', 'daily', '--step', '看待办', '--step', '定三件事'], ok(wf()));
    expect(r.http.post).toHaveBeenCalledWith(W, {
      name: '每日开工', description: '', scene: 'EVERY_DAY',
      steps: [{ title: '看待办', description: '', habitIds: [] }, { title: '定三件事', description: '', habitIds: [] }],
    });
    expect(r.stdout).toContain('已新增工作流 #7');
  });
  it('reads JSON file with step descriptions and habit links; flags win over file', async () => {
    const f = tmpFile('w.json', JSON.stringify({ name: '文件名', scene: 'task', steps: [{ title: 'a', description: 'd', habitIds: [101, 101, 102] }] }));
    const r = await cli(['add', '--from-file', f, '--name', '命令行名'], ok(wf()));
    expect(lastBody(r.http.post)).toEqual({ name: '命令行名', description: '', scene: 'SINGLE_TASK', steps: [{ title: 'a', description: 'd', habitIds: [101, 102] }] });
  });
  it('reads YAML', async () => {
    const f = tmpFile('w.yaml', 'name: Y\nscene: EVERY_DAY\nsteps:\n  - title: s1\n  - 另一步\n');
    const r = await cli(['add', '--from-file', f], ok(wf()));
    expect(lastBody(r.http.post).steps.map((s: any) => s.title)).toEqual(['s1', '另一步']);
  });
  it('accepts a bare array file', () => {
    expect(readWorkflowFile(tmpFile('a.json', '["x","y"]')).steps).toHaveLength(2);
  });
  it.each([
    [['--scene', 'daily', '--step', 's'], '--name'],
    [['--name', 'n', '--step', 's'], '--scene'],
    [['--name', 'n', '--scene', 'daily'], '1～20'],
    [['--name', 'n', '--scene', 'daily', '--step', ' '], '标题'],
    [['--name', 'x'.repeat(51), '--scene', 'daily', '--step', 's'], '最多 50'],
    [['--name', 'n', '--description', 'x'.repeat(201), '--scene', 'daily', '--step', 's'], '最多 200'],
    [['--name', 'n', '--scene', 'monthly', '--step', 's'], '--scene'],
    [['--name', 'n', '--scene', 'daily', '--step', 's', '--from-file', 'nope.json'], '不能同时'],
    [['--name', 'n', '--scene', 'daily', '--from-file', '/nonexistent/x.json'], '无法读取'],
  ])('rejects %j', (args, needle) => rejects(['add', ...args], needle));
  it('step limits: 21 steps, 6 habits, bad ids', () => {
    expect(() => toSteps(Array.from({ length: 21 }, (_, i) => `s${i}`))).toThrow('1～20');
    expect(() => toSteps([{ title: 't', habitIds: [1, 2, 3, 4, 5, 6] }])).toThrow('最多关联 5');
    expect(() => toSteps([{ title: 't', habitIds: ['x'] }])).toThrow('habitIds');
    expect(() => toSteps([{ title: 't', description: 'x'.repeat(301) }])).toThrow('最多 300');
  });
  it('1006 / 1017 are readable', async () => {
    const args = ['add', '--name', 'n', '--scene', 'daily', '--step', 's'];
    expect((await cli(args, bizError(1006, '已有同名工作流'))).stderr).toContain('已存在同名');
    expect((await cli(args, bizError(1017, '工作流已达 10 个上限，请先清理'))).stderr).toContain('上限');
  });
});

describe('workflow edit', () => {
  it('keeps unspecified content and step ids/habit links, sends fetched version', async () => {
    const r = await cli(['edit', '7', '--name', '新名'], getThen(wf()));
    expect(r.http.put).toHaveBeenCalledWith(`${W}/7`, {
      name: '新名', description: '说明', scene: 'SINGLE_TASK', version: 2,
      steps: [{ id: 31, title: '读懂任务', description: '看验收标准', habitIds: [101] }, { id: 32, title: '实现', description: '', habitIds: [] }],
    });
  });
  it('--step replaces all steps; --version overrides', async () => {
    const r = await cli(['edit', '7', '--step', '唯一一步', '--version', '1'], getThen(wf()));
    expect(lastBody(r.http.put)).toMatchObject({ version: 1, steps: [{ title: '唯一一步', description: '', habitIds: [] }] });
  });
  it('--from-file may carry step ids', async () => {
    const f = tmpFile('e.json', JSON.stringify({ steps: [{ id: 32, title: '实现', habitIds: [] }, { title: '新增' }] }));
    const r = await cli(['edit', '7', '--from-file', f], getThen(wf()));
    expect(lastBody(r.http.put).steps[0].id).toBe(32);
    expect(lastBody(r.http.put).steps[1]).toEqual({ title: '新增', description: '', habitIds: [] });
  });
  it('needs a change; validates before fetching', async () => {
    await rejects(['edit', '7'], '至少给出');
    await rejects(['edit', '7', '--name', ' '], '--name');
    await rejects(['edit', '7', '--version', 'x', '--name', 'n'], '--version');
  });
  it('1009 is explained', async () => {
    const r = await cli(['edit', '7', '--name', 'n'], (m) => (m === 'get' ? ok(wf()) : bizError(1009, '冲突')));
    expect(r.stderr).toContain('请刷新');
  });
});

describe('workflow enable / disable / default / remove', () => {
  it('status and default carry the fetched version', async () => {
    const r1 = await cli(['enable', '7'], getThen(wf()));
    expect(r1.http.post).toHaveBeenCalledWith(`${W}/7/status`, { status: 'ENABLED', version: 2 });
    const r2 = await cli(['disable', '7'], getThen(wf()));
    expect(r2.http.post).toHaveBeenCalledWith(`${W}/7/status`, { status: 'DISABLED', version: 2 });
    const r3 = await cli(['default', '7'], getThen(wf({ isDefault: true })));
    expect(r3.http.post).toHaveBeenCalledWith(`${W}/7/default`, { version: 2 });
    expect(r3.stdout).toContain('已设为默认工作流 #7');
  });
  it('default on a disabled workflow: 1007 hint', async () => {
    const r = await cli(['default', '7'], (m) => (m === 'get' ? ok(wf()) : bizError(1007, '只有启用的工作流才能设为默认')));
    expect(r.stderr).toContain('当前状态不支持');
  });
  it('remove needs --yes when not interactive', async () => {
    const r = await cli(['remove', '7']);
    expect(r.exitCode).toBe(1);
    expect(r.http.delete).not.toHaveBeenCalled();
    const r2 = await cli(['remove', '7', '--yes']);
    expect(r2.http.delete).toHaveBeenCalledWith(`${W}/7`, undefined);
    expect(r2.stdout).toContain('已删除工作流 #7');
  });
});

describe('workflow samples / copy-sample', () => {
  it('lists samples from { samples }', async () => {
    const r = await cli(['samples'], ok({ samples: [{ sampleId: 'daily-start', scene: 'EVERY_DAY', name: '每日开工', steps: [{ seq: 1, title: '看待办' }] }] }));
    expect(r.http.get).toHaveBeenCalledWith(`${W}/samples`, { params: undefined });
    expect(r.stdout).toContain('daily-start');
    expect(r.stdout).toContain('1. 看待办');
  });
  it('copies by sampleId; 1017 over the limit', async () => {
    const r = await cli(['copy-sample', 'daily-start'], ok(wf({ name: '每日开工（副本）', status: 'DISABLED' })));
    expect(r.http.post).toHaveBeenCalledWith(`${W}/samples/daily-start/copy`, undefined);
    expect(r.stdout).toContain('每日开工（副本）');
    expect((await cli(['copy-sample', 'x'], bizError(1017, '满'))).stderr).toContain('上限');
  });
});

describe('workflow generate / revise', () => {
  const draft = wf({ id: 41, status: 'DRAFT', source: 'AI_GENERATE', version: 1 });
  it('generate (task) sends scene/taskType/requirement/days with AI timeout and a cost warning', async () => {
    const r = await cli(['generate', '--scene', 'task', '--task-type', '缺陷修复', '--requirement', '先复现', '--days', '14', '--sources', 'work_log'], ok({ workflow: draft, usage: { billed: true, credits: 260 } }));
    expect(r.http.post).toHaveBeenCalledWith(`${W}/generate`, { scene: 'SINGLE_TASK', taskType: '缺陷修复', requirement: '先复现', days: 14, sources: ['WORK_LOG'] }, { timeout: 180000 });
    expect(r.stderr).toContain('消耗 AI 额度');
    expect(r.stdout).toContain('已扣除 260');
    expect(r.stdout).toContain('draft confirm 41');
  });
  it('generate (daily) ignores task type and defaults to 30 days', async () => {
    const r = await cli(['generate', '--scene', 'daily'], ok({ workflow: draft }));
    expect(lastBody(r.http.post)).toEqual({ scene: 'EVERY_DAY', taskType: undefined, requirement: undefined, days: 30, sources: undefined });
  });
  it.each([
    [['--scene', 'task'], '--task-type'],
    [['--scene', 'weekly'], '--scene'],
    [['--scene', 'task', '--task-type', 'x'.repeat(51)], '最多 50'],
    [['--scene', 'daily', '--requirement', 'x'.repeat(201)], '最多 200'],
    [['--scene', 'daily', '--days', '100'], '--days'],
    [['--scene', 'daily', '--sources', 'COMMIT'], '--sources'],
  ])('generate rejects %j', (args, needle) => rejects(['generate', ...args], needle));
  it('generate maps 1017 / 4015 / 9011', async () => {
    for (const [code, needle] of [[1017, '上限'], [4015, 'AI 余额不足'], [9011, 'AI 服务暂时不可用']] as const) {
      expect((await cli(['generate', '--scene', 'daily'], bizError(code, 'x'))).stderr).toContain(needle);
    }
  });
  it('revise posts suggestionNos to the report-scoped path', async () => {
    const r = await cli(['revise', '--report', '12', '--suggestions', '1,3,3'], ok({ workflow: wf({ id: 51, source: 'AI_REVISE', status: 'DRAFT', revision: { changes: [{ type: 'ADDED', after: { title: '补回归测试' } }] } }), usage: { billed: false } }));
    expect(r.http.post).toHaveBeenCalledWith('/api/v1/me/work-workflow-runs/analysis/12/revisions', { suggestionNos: [1, 3] }, { timeout: 180000 });
    expect(r.stdout).toContain('新增：补回归测试');
    expect(r.stdout).toContain('未扣费');
  });
  it('revise validates input and maps 1006 / 1007', async () => {
    await rejects(['revise', '--report', 'x', '--suggestions', '1'], '--report');
    await rejects(['revise', '--report', '1', '--suggestions', '1,a'], '--suggestions');
    expect((await cli(['revise', '--report', '1', '--suggestions', '1'], bizError(1006, '建议 1 已有未处理的修订草稿'))).stderr).toContain('未处理的修订草稿');
    expect((await cli(['revise', '--report', '1', '--suggestions', '1'], bizError(1007, '原工作流已删除'))).stderr).toContain('当前状态不支持');
  });
});

describe('workflow draft', () => {
  const gen = wf({ id: 41, status: 'DRAFT', source: 'AI_GENERATE', version: 1 });
  const rev = wf({ id: 51, status: 'DRAFT', source: 'AI_REVISE', version: 1 });
  const route = (d: unknown) => (m: string): Envelope => (m === 'get' ? ok(d) : ok(wf({ status: 'ENABLED' })));

  it('list asks for DRAFT', async () => {
    const r = await cli(['draft', 'list'], ok({ total: 0, groups: [] }));
    expect(r.http.get).toHaveBeenCalledWith(W, { params: { status: 'DRAFT' } });
  });
  it('confirm a generated draft as-is: only the version', async () => {
    const r = await cli(['draft', 'confirm', '41'], route(gen));
    expect(r.http.post).toHaveBeenCalledWith(`${W}/41/confirm`, { version: 1 });
  });
  it('confirm with edits sends the whole content', async () => {
    const r = await cli(['draft', 'confirm', '41', '--name', '改名'], route(gen));
    expect(lastBody(r.http.post)).toMatchObject({ version: 1, name: '改名', scene: 'SINGLE_TASK' });
    expect(lastBody(r.http.post).steps).toHaveLength(2);
  });
  it('confirming a revision draft goes to confirm-revision and needs --mode', async () => {
    const r1 = await cli(['draft', 'confirm', '51', '--mode', 'replace'], route(rev));
    expect(r1.http.post).toHaveBeenCalledWith(`${W}/51/confirm-revision`, { version: 1, mode: 'REPLACE' });
    const r2 = await cli(['draft', 'confirm', '51', '--mode', 'save-as-new', '--name', '另存'], route(rev));
    expect(lastBody(r2.http.post)).toMatchObject({ version: 1, mode: 'SAVE_AS_NEW', name: '另存' });
    expect(lastBody(r2.http.post).scene).toBeUndefined();
    const r3 = await cli(['draft', 'confirm', '51'], route(rev));
    expect(r3.exitCode).toBe(1);
    expect(r3.stderr).toContain('--mode');
    expect(r3.http.post).not.toHaveBeenCalled();
  });
  it('--mode is refused on a generated draft and for bad values', async () => {
    const r = await cli(['draft', 'confirm', '41', '--mode', 'replace'], route(gen));
    expect(r.stderr).toContain('只用于修订草稿');
    expect(r.http.post).not.toHaveBeenCalled();
    await rejects(['draft', 'confirm', '51', '--mode', 'merge'], '--mode');
  });
  it('1009 on REPLACE tells the user what to do', async () => {
    const r = await cli(['draft', 'confirm', '51', '--mode', 'replace'], (m) => (m === 'get' ? ok(rev) : bizError(1009, '原工作流在生成草稿后已被修改')));
    expect(r.stderr).toContain('1009');
    expect(r.stderr).toContain('已被修改');
  });
  it('reject posts the version', async () => {
    const r = await cli(['draft', 'reject', '41', '--json'], route(gen));
    expect(r.http.post).toHaveBeenCalledWith(`${W}/41/reject`, { version: 1 });
    expect(JSON.parse(r.stdout)).toEqual({ id: 41, rejected: true });
  });
});

describe('no run command', () => {
  it('habit workflow has no start/run subcommand', async () => {
    const r = await cli(['run', '7']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });
});
