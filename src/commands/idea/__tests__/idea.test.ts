import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIdeaCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const idea = (args: string[], response = ok({ id: 12, title: 'T' })) => runCli(registerIdeaCommands, ['idea', ...args], response);

beforeEach(() => {
  delete process.env.GOOD7OB_PRODUCT_ID;
});
afterEach(() => vi.restoreAllMocks());

describe('idea create', () => {
  it('POSTs the mapped body and confirms', async () => {
    const r = await idea(['create', '--product', '3', '--title', '做个导出', '--source', 'customer',
      '--priority', 'high', '--description', 'd', '--expected-value', 'v']);
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas', {
      productId: 3, title: '做个导出', source: 'customer', priority: 'high', description: 'd', expectedValue: 'v',
    });
    expect(r.stdout).toContain('#12');
    expect(r.exitCode).toBeUndefined();
  });

  it('falls back to GOOD7OB_PRODUCT_ID', async () => {
    process.env.GOOD7OB_PRODUCT_ID = '9';
    const r = await idea(['create', '--title', 't', '--source', 'pm']);
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas', { productId: 9, title: 't', source: 'pm' });
  });

  it.each([
    ['unknown source', ['--product', '3', '--title', 't', '--source', 'boss'], '--source'],
    ['unknown priority', ['--product', '3', '--title', 't', '--source', 'pm', '--priority', 'urgent'], '--priority'],
    ['title over 200 chars', ['--product', '3', '--title', 'x'.repeat(201), '--source', 'pm'], '--title'],
    ['blank title', ['--product', '3', '--title', '  ', '--source', 'pm'], '--title'],
    ['expected-value over 500 chars', ['--product', '3', '--title', 't', '--source', 'pm', '--expected-value', 'x'.repeat(501)], '--expected-value'],
    ['non-numeric product', ['--product', 'abc', '--title', 't', '--source', 'pm'], '--product'],
    ['missing product', ['--title', 't', '--source', 'pm'], '--product'],
  ])('rejects %s before calling the API', async (_name, args, needle) => {
    const r = await idea(['create', ...args]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('参数错误');
    expect(r.stderr).toContain(needle);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('requires --title and --source (commander)', async () => {
    const r = await idea(['create', '--product', '3']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('required option');
    expect(noHttpCalls(r)).toBe(true);
  });

  it('maps business error 1001 to a readable message (HTTP 200 + code)', async () => {
    const r = await idea(['create', '--product', '3', '--title', 't', '--source', 'pm'], bizError(1001, 'bad source'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('参数值不合法');
    expect(r.stderr).toContain('bad source');
  });
});

describe('idea list', () => {
  const page = ok({
    records: [
      { id: 1, title: '导出', status: 'approved', priority: 'high', source: 'customer', requirementId: 77, createdAt: '2026-09-19' },
      { id: 2, title: '草稿', status: 'draft', priority: null, source: 'pm', requirementId: null, createdAt: '2026-09-19' },
    ],
    total: 41, size: 20, current: 2, pages: 3,
  });

  it('sends productId + paging defaults and renders rows with — for null', async () => {
    const r = await idea(['list', '--product', '3'], page);
    expect(r.http.get).toHaveBeenCalledWith('/forge/ideas', { params: { productId: 3, pageNum: 1, pageSize: 20 } });
    expect(r.stdout).toContain('导出');
    expect(r.stdout).toContain('#77');
    expect(r.stdout).toMatch(/2\s+draft\s+—\s+pm\s+—/);
    expect(r.stdout).toContain('共 41 条，第 1/3 页');
  });

  it('passes status, keyword, page and page-size', async () => {
    const r = await idea(['list', '--product', '3', '--status', 'evaluating', '-k', '导出', '-p', '2', '--page-size', '100'], page);
    expect(r.http.get).toHaveBeenCalledWith('/forge/ideas', {
      params: { productId: 3, pageNum: 2, pageSize: 100, status: 'evaluating', keyword: '导出' },
    });
  });

  it.each([
    [['--page-size', '101'], '--page-size'],
    [['--page-size', '0'], '--page-size'],
    [['--page', '0'], '--page'],
    [['--status', 'done'], '--status'],
  ])('rejects %j', async (extra, needle) => {
    const r = await idea(['list', '--product', '3', ...extra]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(needle);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('prints raw JSON with --json and a message when empty', async () => {
    const json = await idea(['list', '--product', '3', '--json'], page);
    expect(JSON.parse(json.stdout).total).toBe(41);
    const empty = await idea(['list', '--product', '3'], ok({ records: [], total: 0 }));
    expect(empty.stdout).toContain('没有符合条件');
  });

  it('reports 2000 (not a member) clearly', async () => {
    const r = await idea(['list', '--product', '3'], bizError(2000, 'no access'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('无权访问');
  });
});

describe('idea get', () => {
  const detail = ok({
    idea: { id: 1, productId: 3, title: '做个导出', status: 'approved', priority: 'high', source: 'customer', requirementId: 77, expectedValue: null },
    solutions: [
      { id: 2, name: '方案A', costNote: '2 人天', cycleNote: '1 周', expectedEffectNote: '覆盖 80%', isSelected: true, decisionReason: '最快', decidedBy: 5, decidedAt: '2026-09-19' },
      { id: 3, name: '方案B', costNote: null, cycleNote: '3 周', expectedEffectNote: null, isSelected: false },
    ],
  });

  it('GETs /{id} and shows solutions side by side with the linked requirement', async () => {
    const r = await idea(['get', '1'], detail);
    expect(r.http.get).toHaveBeenCalledWith('/forge/ideas/1', { params: undefined });
    expect(r.stdout).toContain('关联需求: #77');
    expect(r.stdout).toMatch(/ID\s+方案\s+成本\s+周期\s+预期效果\s+选中/);
    expect(r.stdout).toMatch(/2\s+方案A\s+2 人天\s+1 周\s+覆盖 80%\s+✓/);
    expect(r.stdout).toMatch(/3\s+方案B\s+—\s+3 周\s+—/);
    expect(r.stdout).toContain('预期价值: —');
    expect(r.stdout).toContain('决策: 选定 #2 方案A — 最快');
  });

  it('says so when there are no solutions and no requirement', async () => {
    const r = await idea(['get', '1'], ok({ idea: { id: 1, title: 't', status: 'draft' }, solutions: [] }));
    expect(r.stdout).toContain('暂无方案');
    expect(r.stdout).not.toContain('关联需求');
  });

  it('shows the reject reason of a rejected idea', async () => {
    const r = await idea(['get', '1'], ok({ idea: { id: 1, title: 't', status: 'rejected', rejectReason: '重复' }, solutions: [] }));
    expect(r.stdout).toContain('驳回原因: 重复');
  });

  it('maps 1002 and rejects a non-numeric id up front', async () => {
    const missing = await idea(['get', '999'], bizError(1002, 'nope'));
    expect(missing.stderr).toContain('不存在');
    const bad = await idea(['get', 'abc']);
    expect(bad.stderr).toContain('id 必须是正整数');
    expect(noHttpCalls(bad)).toBe(true);
  });
});

describe('idea update / delete / status / reject', () => {
  it('update sends only the given fields via PUT', async () => {
    const r = await idea(['update', '5', '--title', '新标题', '--priority', 'low']);
    expect(r.http.put).toHaveBeenCalledWith('/forge/ideas/5', { title: '新标题', priority: 'low' });
  });

  it('update with nothing to change or an over-long value never calls the API', async () => {
    const none = await idea(['update', '5']);
    expect(none.stderr).toContain('没有要修改的字段');
    const long = await idea(['update', '5', '--expected-value', 'x'.repeat(501)]);
    expect(long.stderr).toContain('--expected-value');
    expect(noHttpCalls(none) && noHttpCalls(long)).toBe(true);
  });

  it('update maps 1007 (locked once approved)', async () => {
    const r = await idea(['update', '5', '--title', 't'], bizError(1007, 'locked'));
    expect(r.stderr).toContain('当前状态不允许');
  });

  it('delete issues DELETE /{id}', async () => {
    const r = await idea(['delete', '5']);
    expect(r.http.delete).toHaveBeenCalledWith('/forge/ideas/5', undefined);
    expect(r.stdout).toContain('已删除');
  });

  it('status only accepts evaluating|archived', async () => {
    const good = await idea(['status', '5', 'evaluating']);
    expect(good.http.post).toHaveBeenCalledWith('/forge/ideas/5/status', { toStatus: 'evaluating' });
    const bad = await idea(['status', '5', 'approved']);
    expect(bad.stderr).toContain('evaluating | archived');
    expect(noHttpCalls(bad)).toBe(true);
  });

  it('reject sends the reason, requires it, and caps it at 1000 chars', async () => {
    const good = await idea(['reject', '5', '--reason', '不做']);
    expect(good.http.post).toHaveBeenCalledWith('/forge/ideas/5/reject', { reason: '不做' });
    const missing = await idea(['reject', '5']);
    expect(missing.stderr).toContain('required option');
    const long = await idea(['reject', '5', '--reason', 'x'.repeat(1001)]);
    expect(long.stderr).toContain('最多 1000');
    expect(noHttpCalls(missing) && noHttpCalls(long)).toBe(true);
  });

  it('maps 1009 to a retry hint', async () => {
    const r = await idea(['reject', '5', '--reason', 'r'], bizError(1009, 'lost race'));
    expect(r.stderr).toContain('请重试');
  });
});

describe('idea solution', () => {
  it('add maps --effect-note to expectedEffectNote', async () => {
    const r = await idea(['solution', 'add', '5', '--name', 'A', '--description', 'd', '--cost-note', 'c', '--cycle-note', 'y', '--effect-note', 'e']);
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/solutions', {
      name: 'A', description: 'd', costNote: 'c', cycleNote: 'y', expectedEffectNote: 'e',
    });
  });

  it('add validates name and note lengths', async () => {
    const name = await idea(['solution', 'add', '5', '--name', 'x'.repeat(201)]);
    expect(name.stderr).toContain('--name');
    const note = await idea(['solution', 'add', '5', '--name', 'A', '--cost-note', 'x'.repeat(501)]);
    expect(note.stderr).toContain('--cost-note');
    expect(noHttpCalls(name) && noHttpCalls(note)).toBe(true);
  });

  it('update PUTs only given fields; delete DELETEs', async () => {
    const up = await idea(['solution', 'update', '5', '8', '--cycle-note', '2 周']);
    expect(up.http.put).toHaveBeenCalledWith('/forge/ideas/5/solutions/8', { cycleNote: '2 周' });
    const none = await idea(['solution', 'update', '5', '8']);
    expect(none.stderr).toContain('没有要修改的字段');
    const del = await idea(['solution', 'delete', '5', '8']);
    expect(del.http.delete).toHaveBeenCalledWith('/forge/ideas/5/solutions/8', undefined);
  });
});

describe('idea select', () => {
  const approved = ok({ idea: { id: 5, status: 'approved', requirementId: 77 }, solutions: [] });

  it('POSTs decisionReason and announces the requirement created in the inbox', async () => {
    const r = await idea(['select', '5', '8', '--reason', '成本最低'], approved);
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/solutions/8/select', { decisionReason: '成本最低' });
    expect(r.stdout).toContain('需求 #77');
    expect(r.stdout).toContain('需求收件箱');
  });

  it('requires --reason and validates ids', async () => {
    const noReason = await idea(['select', '5', '8']);
    expect(noReason.stderr).toContain('required option');
    const badId = await idea(['select', '5', 'x', '--reason', 'r']);
    expect(badId.stderr).toContain('solutionId');
    expect(noHttpCalls(noReason) && noHttpCalls(badId)).toBe(true);
  });

  it('maps 1007 (already approved / not evaluating) and 999 (not logged in)', async () => {
    const state = await idea(['select', '5', '8', '--reason', 'r'], bizError(1007, 'not evaluating'));
    expect(state.exitCode).toBe(1);
    expect(state.stderr).toContain('evaluating');
    const auth = await idea(['select', '5', '8', '--reason', 'r'], bizError(999, 'login'));
    expect(auth.stderr).toContain('未登录');
  });
});
