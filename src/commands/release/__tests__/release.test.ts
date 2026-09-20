import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerReleaseCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const VO = { id: 7, productId: 12, name: 'v1.2 发布', version: '1.2.0', status: 'in_progress', taskCount: 3 };
const release = (args: string[], response = ok(VO)) => runCli(registerReleaseCommands, ['release', ...args], response);

beforeEach(() => {
  delete process.env.GOOD7OB_PRODUCT_ID;
});
afterEach(() => vi.restoreAllMocks());

/** A client-side rejection: exit 1, "参数错误", the offending flag named, and no HTTP call. */
async function expectRejected(args: string[], needle: string) {
  const r = await release(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('release create', () => {
  const base = ['create', '--product', '12', '--name', 'n', '--version', 'v1'];

  it('POSTs the mapped body and confirms', async () => {
    const r = await release(['create', '--product', '12', '--name', 'v1.2 发布', '--version', '1.2.0',
      '--description', 'd', '--start', '2026-10-01', '--end', '2026-10-15']);
    expect(r.http.post).toHaveBeenCalledWith('/forge/releases', {
      productId: 12, name: 'v1.2 发布', version: '1.2.0', description: 'd',
      plannedStartDate: '2026-10-01', plannedEndDate: '2026-10-15',
    });
    expect(r.stdout).toContain('#7');
    expect(r.stdout).toContain('1.2.0');
    expect(r.exitCode).toBeUndefined();
  });

  it('sends only the required fields when the rest is omitted; product falls back to env', async () => {
    process.env.GOOD7OB_PRODUCT_ID = '9';
    const r = await release(['create', '--name', 'n', '--version', 'v1']);
    expect(r.http.post).toHaveBeenCalledWith('/forge/releases', { productId: 9, name: 'n', version: 'v1' });
  });

  it.each([
    ['blank name', ['--name', '  ', '--version', 'v1'], '--name'],
    ['name over 200 chars', ['--name', 'x'.repeat(201), '--version', 'v1'], '--name'],
    ['version over 50 chars', ['--name', 'n', '--version', 'x'.repeat(51)], '--version'],
    ['non-yyyy-MM-dd start', ['--name', 'n', '--version', 'v1', '--start', '2026/10/01'], '--start'],
    ['impossible calendar day', ['--name', 'n', '--version', 'v1', '--end', '2026-02-30'], '--end'],
    ['end before start', ['--name', 'n', '--version', 'v1', '--start', '2026-10-15', '--end', '2026-10-01'], '--end'],
  ])('rejects %s before calling the API', (_name, args, needle) =>
    expectRejected(['create', '--product', '12', ...args], needle));

  it('rejects a non-numeric or missing product', async () => {
    await expectRejected(['create', '--product', 'abc', '--name', 'n', '--version', 'v1'], '--product');
    await expectRejected(['create', '--name', 'n', '--version', 'v1'], '--product');
  });

  it('requires --name and --version (commander)', async () => {
    const r = await release(['create', '--product', '3']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('required option');
    expect(noHttpCalls(r)).toBe(true);
  });

  it.each([
    [1006, '版本号已存在'],
    [1002, '不存在'],
    [2000, '无权访问'],
  ])('maps business error %i (HTTP 200 + code) and keeps the server message', async (code, text) => {
    const r = await release(base, bizError(code, 'server says no'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain('server says no');
  });

  it('prints the raw VO with --json', async () => {
    const r = await release([...base, '--json']);
    expect(JSON.parse(r.stdout)).toEqual(VO);
  });
});

describe('release list', () => {
  const rows = ok([
    { id: 8, name: '热修复', version: '1.2.1', status: 'planned', taskCount: 0, plannedStartDate: null, plannedEndDate: '2026-10-15' },
    { id: 7, name: 'v1.2 发布', version: '1.2.0', status: 'released', taskCount: null, plannedStartDate: '2026-10-01', plannedEndDate: null },
  ]);

  it('sends productId (and status) and renders a table with — for null, never 0', async () => {
    const r = await release(['list', '--product', '12', '--status', 'planned'], rows);
    expect(r.http.get).toHaveBeenCalledWith('/forge/releases', { params: { productId: 12, status: 'planned' } });
    expect(r.stdout).toMatch(/ID\s+状态\s+版本\s+名称\s+任务\s+计划开始\s+计划结束/);
    expect(r.stdout).toMatch(/8\s+planned\s+1\.2\.1\s+热修复\s+0\s+—\s+2026-10-15/);
    expect(r.stdout).toMatch(/7\s+released\s+1\.2\.0\s+v1\.2 发布\s+—\s+2026-10-01\s+—/);
    expect(r.stdout).toContain('共 2 个 Release');
  });

  it('uses GOOD7OB_PRODUCT_ID and omits status when not given', async () => {
    process.env.GOOD7OB_PRODUCT_ID = '5';
    const r = await release(['list'], rows);
    expect(r.http.get).toHaveBeenCalledWith('/forge/releases', { params: { productId: 5 } });
  });

  it('rejects an unknown status; prints JSON; says so when empty', async () => {
    await expectRejected(['list', '--product', '12', '--status', 'done'], '--status');
    const json = await release(['list', '--product', '12', '--json'], rows);
    expect(JSON.parse(json.stdout)).toHaveLength(2);
    const empty = await release(['list', '--product', '12'], ok([]));
    expect(empty.stdout).toContain('没有符合条件');
  });

  it('reports 2000 (not a member) clearly', async () => {
    const r = await release(['list', '--product', '12'], bizError(2000, 'no access'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('无权访问');
  });
});

describe('release get', () => {
  it('GETs /{id} and shows the pending approval with a follow-up hint', async () => {
    const r = await release(['get', '7'], ok({ ...VO, status: 'awaiting_approval', pendingApprovalId: 31, description: '说明', plannedStartDate: '2026-10-01', releasedAt: null }));
    expect(r.http.get).toHaveBeenCalledWith('/forge/releases/7', { params: undefined });
    expect(r.stdout).toContain('Release #7  v1.2 发布');
    expect(r.stdout).toContain('计划:     2026-10-01 → —');
    expect(r.stdout).toContain('发布于: —');
    expect(r.stdout).toContain('待处理审批: #31（good7ob approval get 31）');
    expect(r.stdout).toContain('说明');
  });

  it('omits the approval line when there is none, renders null counts as —', async () => {
    const r = await release(['get', '7'], ok({ id: 7, name: 'n', status: 'planned', taskCount: null, pendingApprovalId: null }));
    expect(r.stdout).not.toContain('待处理审批');
    expect(r.stdout).toContain('任务数:   —');
  });

  it('rejects a bad id; maps 1002', async () => {
    await expectRejected(['get', 'abc'], 'id');
    await expectRejected(['get', '0'], 'id');
    const r = await release(['get', '99'], bizError(1002, 'gone'));
    expect(r.stderr).toContain('不存在');
  });
});

describe('release update', () => {
  it('PUTs only the flags that were given', async () => {
    const r = await release(['update', '7', '--name', '新名', '--end', '2026-11-01']);
    expect(r.http.put).toHaveBeenCalledWith('/forge/releases/7', { name: '新名', plannedEndDate: '2026-11-01' });
    expect(r.stdout).toContain('#7');
  });

  it.each([
    ['nothing to change', ['update', '7'], '没有要修改'],
    ['blank name', ['update', '7', '--name', ' '], '--name'],
    ['version over 50 chars', ['update', '7', '--version', 'x'.repeat(51)], '--version'],
    ['end before start', ['update', '7', '--start', '2026-10-15', '--end', '2026-10-01'], '--end'],
    ['bad id', ['update', 'x', '--name', 'n'], 'id'],
  ])('rejects %s before calling the API', (_n, args, needle) => expectRejected(args, needle));

  it('maps 1007 (wrong state) and 1006 (duplicate version)', async () => {
    const bad = await release(['update', '7', '--name', 'n'], bizError(1007, '仅 planned / in_progress 的发布可编辑'));
    expect(bad.stderr).toContain('当前状态不允许');
    const dup = await release(['update', '7', '--version', '1.0'], bizError(1006, 'dup'));
    expect(dup.stderr).toContain('版本号已存在');
  });
});

describe('release delete', () => {
  it('DELETEs /{id} with no confirmation prompt', async () => {
    const r = await release(['delete', '7'], ok(null));
    expect(r.http.delete).toHaveBeenCalledWith('/forge/releases/7', undefined);
    expect(r.stdout).toContain('已删除: #7');
  });

  it('prints {deleted,id} with --json; maps 1007; rejects a bad id', async () => {
    expect(JSON.parse((await release(['delete', '7', '--json'], ok(null))).stdout)).toEqual({ deleted: true, id: 7 });
    const r = await release(['delete', '7'], bizError(1007, 'x'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('当前状态不允许');
    await expectRejected(['delete', '0'], 'id');
  });
});

describe('release start / cancel', () => {
  it.each([
    ['start', '已开始 (in_progress)'],
    ['cancel', '已取消 (cancelled)'],
  ])('%s POSTs /{id}/%s', async (action, text) => {
    const r = await release([action, '7']);
    expect(r.http.post).toHaveBeenCalledWith(`/forge/releases/7/${action}`, undefined);
    expect(r.stdout).toContain(text);
    expect(JSON.parse((await release([action, '7', '--json'])).stdout)).toEqual(VO);
  });

  it.each(['start', 'cancel'])('%s maps 1007 and 2000, rejects a bad id', async (action) => {
    const state = await release([action, '7'], bizError(1007, 'illegal transition'));
    expect(state.exitCode).toBe(1);
    expect(state.stderr).toContain('当前状态不允许');
    expect(state.stderr).toContain('illegal transition');
    const perm = await release([action, '7'], bizError(2000, 'x'));
    expect(perm.stderr).toContain('无权访问');
    await expectRejected([action, 'abc'], 'id');
  });
});

describe('release request-approval', () => {
  const moved = ok({ ...VO, status: 'awaiting_approval', pendingApprovalId: 31 });

  it('POSTs the description and points at the new approval', async () => {
    const r = await release(['request-approval', '7', '--description', '请审批'], moved);
    expect(r.http.post).toHaveBeenCalledWith('/forge/releases/7/request-approval', { description: '请审批' });
    expect(r.stdout).toContain('awaiting_approval');
    expect(r.stdout).toContain('审批 #31（good7ob approval get 31）');
  });

  it('sends an empty body without --description', async () => {
    const r = await release(['request-approval', '7'], moved);
    expect(r.http.post).toHaveBeenCalledWith('/forge/releases/7/request-approval', {});
  });

  it('maps 1006 (already pending) and 1007', async () => {
    const dup = await release(['request-approval', '7'], bizError(1006, 'pending exists'));
    expect(dup.stderr).toContain('已有待处理审批');
    const state = await release(['request-approval', '7'], bizError(1007, 'not in_progress'));
    expect(state.stderr).toContain('当前状态不允许');
  });
});

describe('release tasks', () => {
  it('lists tasks; null progress/owner render as —', async () => {
    const r = await release(['tasks', '7'], ok([
      { id: 1, name: '登录', status: 'done', progress: 100, projectId: 4, responsibleId: 11 },
      { id: 2, name: '支付', status: 'in_progress', progress: null, projectId: null, responsibleId: null },
    ]));
    expect(r.http.get).toHaveBeenCalledWith('/forge/releases/7/tasks', { params: undefined });
    expect(r.stdout).toMatch(/1\s+done\s+100%\s+登录\s+4\s+11/);
    expect(r.stdout).toMatch(/2\s+in_progress\s+—\s+支付\s+—\s+—/);
    expect(r.stdout).toContain('共 2 个任务');
  });

  it('says so when empty; prints JSON', async () => {
    expect((await release(['tasks', '7'], ok([]))).stdout).toContain('还没有关联任务');
    expect(JSON.parse((await release(['tasks', '7', '--json'], ok([{ id: 1 }]))).stdout)).toEqual([{ id: 1 }]);
  });

  it('add POSTs the de-duplicated ids and reports the new count', async () => {
    const r = await release(['tasks', 'add', '7', '--task-ids', '1, 2,2,3'], ok({ ...VO, taskCount: 3 }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/releases/7/tasks', { taskIds: [1, 2, 3] });
    expect(r.stdout).toContain('已关联 3 个任务');
    expect(r.stdout).toContain('现有 3 个任务');
  });

  it('remove DELETEs with a body', async () => {
    const r = await release(['tasks', 'remove', '7', '--task-ids', '4,5'], ok({ ...VO, taskCount: 1 }));
    expect(r.http.delete).toHaveBeenCalledWith('/forge/releases/7/tasks', { data: { taskIds: [4, 5] } });
    expect(r.stdout).toContain('已解除 2 个任务');
  });

  it('honours --json placed after the subcommand', async () => {
    const r = await release(['tasks', 'add', '7', '--task-ids', '1', '--json'], ok({ ...VO, taskCount: 1 }));
    expect(JSON.parse(r.stdout)).toEqual({ ...VO, taskCount: 1 });
  });

  it('accepts exactly 200 ids and rejects 201', async () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1).join(',');
    const okRun = await release(['tasks', 'add', '7', '--task-ids', ids(200)]);
    expect((okRun.http.post.mock.calls[0][1] as { taskIds: number[] }).taskIds).toHaveLength(200);
    await expectRejected(['tasks', 'add', '7', '--task-ids', ids(201)], '--task-ids');
  });

  it.each([
    ['empty entry', '1,,2'],
    ['zero', '0,1'],
    ['negative', '-3'],
    ['non-numeric', '1,a'],
    ['decimal', '1.5'],
    ['beyond 2^53 (would round to another id)', '9007199254740993'],
    ['blank', ' '],
  ])('rejects --task-ids with %s', (_n, ids) => expectRejected(['tasks', 'add', '7', '--task-ids', ids], '--task-ids'));

  it('requires --task-ids (commander) and a valid release id', async () => {
    const r = await release(['tasks', 'add', '7']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('required option');
    await expectRejected(['tasks', 'add', 'x', '--task-ids', '1'], 'id');
  });

  it('maps 1006 (task in another release), 1001 and 1007', async () => {
    const other = await release(['tasks', 'add', '7', '--task-ids', '1'], bizError(1006, '任务 1 已属于发布 3'));
    expect(other.stderr).toContain('已属于另一个未取消的 Release');
    expect(other.stderr).toContain('任务 1 已属于发布 3');
    const bad = await release(['tasks', 'add', '7', '--task-ids', '1'], bizError(1001, '任务不存在'));
    expect(bad.stderr).toContain('参数值不合法');
    const state = await release(['tasks', 'remove', '7', '--task-ids', '1'], bizError(1007, 'x'));
    expect(state.stderr).toContain('当前状态不允许');
  });
});
