import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIdeaCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const cs = (args: string[], response = ok(null)) => runCli(registerIdeaCommands, ['idea', 'change-set', ...args], response);

beforeEach(() => {
  delete process.env.GOOD7OB_PRODUCT_ID;
});
afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await cs(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const changeSet = { id: 5, ideaId: 21, productId: 12, solutionId: 33, code: 'CHG-2026-0001', title: '订单导出落地', status: 'draft', approvalId: null, moduleId: null, createdAt: '2026-09-19 10:00:00' };
const item = (o = {}) => ({ id: 9, objectType: 'API', objectId: null, objectRef: 'POST /orders/export', changeKind: 'add', description: '新增导出接口', source: 'ai', confidence: 'medium', isConfirmed: false, taskId: null, ...o });

describe('change-set create', () => {
  it('posts ideaId + title, and solution / summary only when given', async () => {
    const min = await cs(['create', '21', '--title', '订单导出落地'], ok(changeSet));
    expect(min.http.post).toHaveBeenCalledWith('/forge/change-sets', { ideaId: 21, title: '订单导出落地' });
    expect(min.stdout).toContain('CHG-2026-0001 (#5)');
    const full = await cs(['create', '21', '--title', 'T', '--solution', '33', '--summary', 'S'], ok(changeSet));
    expect(full.http.post).toHaveBeenCalledWith('/forge/change-sets', { ideaId: 21, title: 'T', solutionId: 33, summary: 'S' });
  });

  it('--json prints the change set', async () => {
    const r = await cs(['create', '21', '--title', 'T', '--json'], ok(changeSet));
    expect(JSON.parse(r.stdout)).toEqual(changeSet);
  });

  it.each([
    [['create', 'x', '--title', 'T'], 'ideaId'],
    [['create', '21', '--title', ' '], '--title'],
    [['create', '21', '--title', 'x'.repeat(201)], '--title'],
    [['create', '21', '--title', 'T', '--solution', '0'], '--solution'],
    [['create', '21', '--title', 'T', '--summary', 'x'.repeat(2001)], '--summary'],
  ])('rejects %j', async (args, needle) => {
    await expectRejected(args, needle);
  });

  it('requires --title (commander) and maps 1007 (idea not approved/planning)', async () => {
    const missing = await cs(['create', '21']);
    expect(missing.exitCode).toBe(1);
    expect(noHttpCalls(missing)).toBe(true);
    const r = await cs(['create', '21', '--title', 'T'], bizError(1007, 'idea is draft'));
    expect(r.stderr).toContain('approved/planning');
    expect(r.stderr).toContain('idea is draft');
  });
});

describe('change-set list / get / update', () => {
  const page = ok({ records: [changeSet, { ...changeSet, id: 6, code: null, approvalId: 3 }], total: 2 });

  it('lists by idea, or by product (flag or env), sending status and paging', async () => {
    const byIdea = await cs(['list', '--idea', '21', '--status', 'approved', '-p', '2', '--page-size', '5'], page);
    expect(byIdea.http.get).toHaveBeenCalledWith('/forge/change-sets', { params: { ideaId: 21, pageNum: 2, pageSize: 5, status: 'approved' } });
    const byProduct = await cs(['list', '--product', '12'], page);
    expect(byProduct.http.get).toHaveBeenCalledWith('/forge/change-sets', { params: { productId: 12, pageNum: 1, pageSize: 20 } });
    process.env.GOOD7OB_PRODUCT_ID = '12';
    const byEnv = await cs(['list'], page);
    expect(byEnv.http.get).toHaveBeenCalledWith('/forge/change-sets', { params: { productId: 12, pageNum: 1, pageSize: 20 } });
  });

  it('renders rows with "—" for a missing code / approval, and the total', async () => {
    const r = await cs(['list', '--idea', '21'], page);
    expect(r.stdout).toContain('CHG-2026-0001');
    expect(r.stdout).toContain('#3');
    expect(r.stdout).toContain('—');
    expect(r.stdout).toContain('共 2 条，第 1/1 页');
    const empty = await cs(['list', '--idea', '21'], ok({ records: [], total: 0 }));
    expect(empty.stdout).toContain('没有符合条件的变更集');
  });

  it.each([
    [['list'], '产品 ID'],
    [['list', '--idea', '1', '--product', '2'], '二选一'],
    [['list', '--idea', '1', '--status', 'done'], '--status'],
    [['list', '--idea', '1', '--page-size', '101'], '--page-size'],
    [['list', '--idea', '1', '--page', '0'], '--page'],
    [['list', '--idea', 'x'], '--idea'],
  ])('list rejects %j', async (args, needle) => {
    await expectRejected(args, needle);
  });

  it.each(['draft', 'impact_analyzed', 'pending_approval', 'approved', 'applied', 'cancelled'])('list accepts --status %s', async (status) => {
    const r = await cs(['list', '--idea', '1', '--status', status], page);
    expect(r.exitCode).toBeUndefined();
  });

  it('get renders header, items table (source / confidence / confirmation) and JSON', async () => {
    const detail = { changeSet: { ...changeSet, status: 'impact_analyzed', approvalId: 8, summary: '摘要文字' },
      items: [item(), item({ id: 10, objectId: 77, objectRef: null, source: 'manual', confidence: null, isConfirmed: true, taskId: 100 })] };
    const r = await cs(['get', '5'], ok(detail));
    expect(r.http.get).toHaveBeenCalledWith('/forge/change-sets/5', { params: undefined });
    expect(r.stdout).toContain('变更集 CHG-2026-0001 (#5)');
    expect(r.stdout).toContain('impact_analyzed');
    expect(r.stdout).toContain('审批单:   #8');
    expect(r.stdout).toContain('摘要文字');
    expect(r.stdout).toContain('条目 (2，已确认 1)');
    expect(r.stdout).toContain('POST /orders/export');
    expect(r.stdout).toContain('ai/medium');
    expect(r.stdout).toContain('✗ 待确认');
    expect(r.stdout).toContain('✓ 已确认');
    expect(r.stdout).toContain('#77');
    expect(r.stdout).toContain('#100');
    expect(JSON.parse((await cs(['get', '5', '--json'], ok(detail))).stdout)).toEqual(detail);
  });

  it('get with no items / null fields shows "—" and the empty hint', async () => {
    const r = await cs(['get', '5'], ok({ changeSet: { id: 5 }, items: null }));
    expect(r.stdout).toContain('变更集 — (#5)');
    expect(r.stdout).toContain('暂无');
    expect(r.stdout).toContain('—');
  });

  it('get maps 1002 / 2000', async () => {
    expect((await cs(['get', '5'], bizError(1002, 'x'))).stderr).toContain('不存在');
    expect((await cs(['get', '5'], bizError(2000, 'x'))).stderr).toContain('无权访问');
    await expectRejected(['get', 'abc'], 'id');
  });

  it('update sends only the given fields and needs at least one', async () => {
    const r = await cs(['update', '5', '--title', 'new'], ok(changeSet));
    expect(r.http.put).toHaveBeenCalledWith('/forge/change-sets/5', { title: 'new' });
    const s = await cs(['update', '5', '--summary', ''], ok(changeSet));
    expect(s.http.put).toHaveBeenCalledWith('/forge/change-sets/5', { summary: '' });
    await expectRejected(['update', '5'], '至少指定');
    await expectRejected(['update', '5', '--title', ' '], '--title');
    await expectRejected(['update', '5', '--summary', 'x'.repeat(2001)], '--summary');
    expect((await cs(['update', '5', '--title', 'n'], bizError(1007))).stderr).toContain('当前状态不允许');
  });
});

describe('change-set item', () => {
  it('add posts type (upper-cased), kind (lower-cased), description and object ref', async () => {
    const r = await cs(['item', 'add', '5', '--type', 'api', '--kind', 'ADD', '--description', '新增导出接口', '--object-ref', 'POST /orders/export'], ok(item()));
    expect(r.http.post).toHaveBeenCalledWith('/forge/change-sets/5/items', {
      objectType: 'API', changeKind: 'add', description: '新增导出接口', objectRef: 'POST /orders/export',
    });
    expect(r.stdout).toContain('条目已添加: #9');
  });

  it('add accepts --object-id alone, or both id and ref', async () => {
    const base = ['item', 'add', '5', '--type', 'TEST_CASE', '--kind', 'update', '--description', 'd'];
    const byId = await cs([...base, '--object-id', '77'], ok(item()));
    expect(byId.http.post).toHaveBeenCalledWith('/forge/change-sets/5/items', { objectType: 'TEST_CASE', changeKind: 'update', description: 'd', objectId: 77 });
    const both = await cs([...base, '--object-id', '77', '--object-ref', 'r'], ok(item()));
    expect(both.http.post).toHaveBeenCalledWith('/forge/change-sets/5/items', { objectType: 'TEST_CASE', changeKind: 'update', description: 'd', objectId: 77, objectRef: 'r' });
  });

  it.each(['PRD', 'FP', 'RP', 'UI', 'API', 'DB', 'ARCH', 'TEST_CASE', 'TASK', 'OTHER'])('add accepts type %s', async (type) => {
    const r = await cs(['item', 'add', '5', '--type', type, '--kind', 'remove', '--description', 'd', '--object-ref', 'r'], ok(item()));
    expect(r.exitCode).toBeUndefined();
  });

  it.each([
    [['--type', 'DOC', '--kind', 'add', '--description', 'd', '--object-ref', 'r'], '--type'],
    [['--type', 'API', '--kind', 'delete', '--description', 'd', '--object-ref', 'r'], '--kind'],
    [['--type', 'API', '--kind', 'add', '--description', ' ', '--object-ref', 'r'], '--description'],
    [['--type', 'API', '--kind', 'add', '--description', 'x'.repeat(1001), '--object-ref', 'r'], '--description'],
    [['--type', 'API', '--kind', 'add', '--description', 'd'], '至少提供一个'],
    [['--type', 'API', '--kind', 'add', '--description', 'd', '--object-ref', 'x'.repeat(301)], '--object-ref'],
    [['--type', 'API', '--kind', 'add', '--description', 'd', '--object-ref', '  '], '--object-ref'],
    [['--type', 'API', '--kind', 'add', '--description', 'd', '--object-id', '0'], '--object-id'],
    [['--type', 'API', '--kind', 'add', '--description', 'd', '--object-id', '1.5'], '--object-id'],
    [['--kind', 'add', '--description', 'd', '--object-id', '1'], '--type'],
    [['--type', 'API', '--description', 'd', '--object-id', '1'], '--kind'],
    [['--type', 'API', '--kind', 'add', '--object-id', '1'], '--description'],
  ])('add rejects %j', async (extra, needle) => {
    await expectRejected(['item', 'add', '5', ...extra], needle);
  });

  it('add accepts an object ref of exactly 300 chars; maps 1006 (duplicate object) and 1007 (frozen)', async () => {
    const base = ['item', 'add', '5', '--type', 'API', '--kind', 'add', '--description', 'd'];
    expect((await cs([...base, '--object-ref', 'x'.repeat(300)], ok(item()))).exitCode).toBeUndefined();
    expect((await cs([...base, '--object-ref', 'r'], bizError(1006, 'dup'))).stderr).toContain('该对象已有条目');
    expect((await cs([...base, '--object-ref', 'r'], bizError(1007, 'frozen'))).stderr).toContain('仅 draft/impact_analyzed');
  });

  it('update sends only the given fields; needs at least one; retargets validate like add', async () => {
    const r = await cs(['item', 'update', '5', '9', '--kind', 'remove', '--object-id', '3'], ok(item()));
    expect(r.http.put).toHaveBeenCalledWith('/forge/change-sets/5/items/9', { changeKind: 'remove', objectId: 3 });
    await expectRejected(['item', 'update', '5', '9'], '至少指定');
    await expectRejected(['item', 'update', '5', '9', '--type', 'nope'], '--type');
    await expectRejected(['item', 'update', '5', 'x', '--kind', 'add'], 'itemId');
  });

  it('remove DELETEs the item', async () => {
    const r = await cs(['item', 'remove', '5', '9']);
    expect(r.http.delete).toHaveBeenCalledWith('/forge/change-sets/5/items/9', undefined);
    expect(r.stdout).toContain('条目已删除: #9');
    await expectRejected(['item', 'remove', '5', '0'], 'itemId');
  });

  it('confirm sends confirmed true; --no sends false', async () => {
    const yes = await cs(['item', 'confirm', '5', '9'], ok(item({ isConfirmed: true })));
    expect(yes.http.post).toHaveBeenCalledWith('/forge/change-sets/5/items/9/confirm', { confirmed: true });
    expect(yes.stdout).toContain('已确认');
    const no = await cs(['item', 'confirm', '5', '9', '--no'], ok(item()));
    expect(no.http.post).toHaveBeenCalledWith('/forge/change-sets/5/items/9/confirm', { confirmed: false });
    expect(no.stdout).toContain('已取消确认');
    expect(no.exitCode).toBeUndefined();
  });
});

describe('change-set analyze', () => {
  const analyzed = { changeSet: { ...changeSet, status: 'impact_analyzed' }, items: [item(), item({ id: 11, source: 'trace', confidence: null, changeKind: 'update' })], added: { trace: 1, ai: 1 }, warning: null };

  it('POSTs with a long timeout and renders the added counts and the unconfirmed hint', async () => {
    const r = await cs(['analyze', '5'], ok(analyzed));
    expect(r.http.post).toHaveBeenCalledWith('/forge/change-sets/5/analyze', undefined, { timeout: 180_000 });
    expect(r.stdout).toContain('追溯 1 条 / AI 建议 1 条');
    expect(r.stdout).toContain('待确认');
    expect(r.stdout).toContain('trace');
    expect(r.stdout).not.toContain('告警');
  });

  it('shows the degrade warning instead of failing, and "—" for a missing added block', async () => {
    const r = await cs(['analyze', '5'], ok({ ...analyzed, added: null, warning: 'AI_TIMEOUT: read timed out' }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('告警');
    expect(r.stdout).toContain('AI_TIMEOUT: read timed out');
    expect(r.stdout).toContain('追溯 — 条 / AI 建议 — 条');
  });

  it('--json, and 1007 mapping', async () => {
    expect(JSON.parse((await cs(['analyze', '5', '--json'], ok(analyzed))).stdout)).toEqual(analyzed);
    expect((await cs(['analyze', '5'], bizError(1007, 'applied'))).stderr).toContain('当前状态不允许');
  });
});

describe('change-set submit / cancel', () => {
  it('submit prints the approval pointer', async () => {
    const r = await cs(['submit', '5'], ok({ ...changeSet, status: 'pending_approval', approvalId: 8 }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/change-sets/5/submit', undefined);
    expect(r.stdout).toContain('pending_approval');
    expect(r.stdout).toContain('审批单 #8（good7ob approval get 8）');
  });

  it('submit maps 1007 (no confirmed item) and 1006 (approval exists)', async () => {
    expect((await cs(['submit', '5'], bizError(1007, 'no confirmed items'))).stderr).toContain('no confirmed items');
    expect((await cs(['submit', '5'], bizError(1006, 'pending'))).stderr).toContain('待处理的审批');
  });

  it('cancel POSTs and reports', async () => {
    const r = await cs(['cancel', '5'], ok({ ...changeSet, status: 'cancelled' }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/change-sets/5/cancel', undefined);
    expect(r.stdout).toContain('已取消');
    await expectRejected(['cancel', 'x'], 'id');
  });
});

describe('change-set apply', () => {
  const applied = {
    changeSet: { ...changeSet, status: 'applied' }, moduleId: 40,
    tasks: [{ itemId: 9, taskId: 101 }, { itemId: 10, taskId: 102 }], traceLinks: 3, ideaStatus: 'planning',
    summary: '变更集 CHG-2026-0001 已 Apply：2 个任务，3 条追溯',
  };

  it('sends an empty body by default and --module as moduleId', async () => {
    const plain = await cs(['apply', '5'], ok(applied));
    expect(plain.http.post).toHaveBeenCalledWith('/forge/change-sets/5/apply', {});
    const withModule = await cs(['apply', '5', '--module', '40'], ok(applied));
    expect(withModule.http.post).toHaveBeenCalledWith('/forge/change-sets/5/apply', { moduleId: 40 });
  });

  it('prints created tasks, trace links, idea status and that documents are NOT edited', async () => {
    const r = await cs(['apply', '5'], ok(applied));
    expect(r.stdout).toContain('已创建任务 2 个，新建追溯关系 3 条');
    expect(r.stdout).toContain('#101');
    expect(r.stdout).toContain('#102');
    expect(r.stdout).toContain('模块 #40');
    expect(r.stdout).toContain('planning');
    expect(r.stdout).toContain('不会自动修改');
  });

  it('handles a sparse response with "—"', async () => {
    const r = await cs(['apply', '5'], ok({ changeSet: { id: 5 } }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('已创建任务 0 个，新建追溯关系 — 条');
  });

  it('rejects a bad --module, maps 1007 / 2000 / 1001, supports --json', async () => {
    await expectRejected(['apply', '5', '--module', '0'], '--module');
    expect((await cs(['apply', '5'], bizError(1007, 'not approved'))).stderr).toContain('Apply 要求 approved');
    expect((await cs(['apply', '5'], bizError(2000, 'x'))).stderr).toContain('owner/admin');
    expect((await cs(['apply', '5', '--module', '9'], bizError(1001, 'module of another product'))).stderr).toContain('moduleId 不属于该产品');
    expect(JSON.parse((await cs(['apply', '5', '--json'], ok(applied))).stdout)).toEqual(applied);
  });
});
