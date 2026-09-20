import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTraceCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const LINK = {
  id: 5, productId: 12, sourceType: 'IDEA', sourceId: 5, targetType: 'REQUIREMENT', targetId: 9,
  linkType: 'derived_from', createdBy: 11, createdAt: '2026-09-19T10:00:00',
};
const trace = (args: string[], response = ok(LINK)) => runCli(registerTraceCommands, ['trace', ...args], response);

beforeEach(() => {
  delete process.env.GOOD7OB_PRODUCT_ID;
});
afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await trace(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('trace create', () => {
  const full = ['create', '--product', '12', '--source-type', 'idea', '--source-id', '5',
    '--target-type', 'REQUIREMENT', '--target-id', '9', '--link-type', 'derived_from'];

  it('POSTs the mapped body (types normalised to upper case) and shows the edge', async () => {
    const r = await trace(full);
    expect(r.http.post).toHaveBeenCalledWith('/forge/trace-links', {
      productId: 12, sourceType: 'IDEA', sourceId: 5, targetType: 'REQUIREMENT', targetId: 9, linkType: 'derived_from',
    });
    expect(r.stdout).toContain('#5 IDEA#5 —derived_from→ REQUIREMENT#9');
    expect(r.exitCode).toBeUndefined();
  });

  it('falls back to GOOD7OB_PRODUCT_ID', async () => {
    process.env.GOOD7OB_PRODUCT_ID = '9';
    const r = await trace(full.filter((_, i) => i !== 1 && i !== 2));
    expect((r.http.post.mock.calls[0][1] as { productId: number }).productId).toBe(9);
  });

  it.each(['derived_from', 'impacts', 'implements', 'verifies'])('accepts link type %s', async (linkType) => {
    const r = await trace(full.slice(0, -1).concat(linkType));
    expect(r.exitCode).toBeUndefined();
    expect((r.http.post.mock.calls[0][1] as { linkType: string }).linkType).toBe(linkType);
  });

  const swap = (flag: string, value: string) => full.map((a, i) => (full[i - 1] === flag ? value : a));

  it.each([
    ['unknown link type', swap('--link-type', 'blocks'), '--link-type'],
    ['source type with a dash', swap('--source-type', 'my-idea'), '--source-type'],
    ['one-letter target type', swap('--target-type', 'R'), '--target-type'],
    ['33-char type', swap('--source-type', 'A'.repeat(33)), '--source-type'],
    ['zero source id', swap('--source-id', '0'), '--source-id'],
    ['non-numeric target id', swap('--target-id', 'x'), '--target-id'],
    ['non-numeric product', swap('--product', 'x'), '--product'],
    ['self link', swap('--target-id', '5').map((a) => (a === 'REQUIREMENT' ? 'IDEA' : a)), '不能是同一个对象'],
  ])('rejects %s before calling the API', (_n, args, needle) => expectRejected(args, needle));

  it('rejects a missing product; requires the other flags (commander)', async () => {
    await expectRejected(full.filter((_, i) => i !== 1 && i !== 2), '--product');
    const r = await trace(['create', '--product', '12']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('required option');
    expect(noHttpCalls(r)).toBe(true);
  });

  it.each([
    [1006, '追溯关系已存在'],
    [1001, '参数值不合法'],
    [2000, '无权访问'],
    [1002, '不存在'],
  ])('maps business error %i (HTTP 200 + code)', async (code, text) => {
    const r = await trace(full, bizError(code, 'server says no'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain('server says no');
  });

  it('prints the raw link with --json', async () => {
    expect(JSON.parse((await trace([...full, '--json'])).stdout)).toEqual(LINK);
  });
});

describe('trace list', () => {
  const page = ok({
    records: [LINK, { id: 4, sourceType: 'TASK', sourceId: 3, targetType: null, targetId: null, linkType: 'verifies', createdBy: null, createdAt: null }],
    total: 120, size: 50, current: 1, pages: 3,
  });

  it('sends productId + paging defaults (50)', async () => {
    const r = await trace(['list', '--product', '12'], page);
    expect(r.http.get).toHaveBeenCalledWith('/forge/trace-links', { params: { productId: 12, pageNum: 1, pageSize: 50 } });
  });

  it('renders rows with — for null and a page footer', async () => {
    const r = await trace(['list', '--product', '12'], page);
    expect(r.stdout).toMatch(/ID\s+来源\s+关系\s+目标\s+创建人\s+创建时间/);
    expect(r.stdout).toMatch(/5\s+IDEA#5\s+derived_from\s+REQUIREMENT#9\s+11\s+2026-09-19 10:00:00/);
    expect(r.stdout).toMatch(/4\s+TASK#3\s+verifies\s+—#—\s+—\s+—/);
    expect(r.stdout).toContain('共 120 条，第 1/3 页');
  });

  it('passes source / target pairs, link type and paging (page size up to 200)', async () => {
    const r = await trace(['list', '--product', '12', '--source-type', 'idea', '--source-id', '5',
      '--target-type', 'task', '--target-id', '8', '--link-type', 'implements', '-p', '2', '--page-size', '200'], page);
    expect(r.http.get).toHaveBeenCalledWith('/forge/trace-links', {
      params: { productId: 12, pageNum: 2, pageSize: 200, sourceType: 'IDEA', sourceId: 5, targetType: 'TASK', targetId: 8, linkType: 'implements' },
    });
  });

  it.each([
    ['source type without id', ['--source-type', 'IDEA'], '--source-type 与 --source-id'],
    ['source id without type', ['--source-id', '5'], '--source-type 与 --source-id'],
    ['target type without id', ['--target-type', 'TASK'], '--target-type 与 --target-id'],
    ['target id without type', ['--target-id', '5'], '--target-type 与 --target-id'],
    ['unknown link type', ['--link-type', 'x'], '--link-type'],
    ['page size 201', ['--page-size', '201'], '--page-size'],
    ['page size 0', ['--page-size', '0'], '--page-size'],
    ['page 0', ['--page', '0'], '--page'],
  ])('rejects %s before calling the API', (_n, args, needle) => expectRejected(['list', '--product', '12', ...args], needle));

  it('needs a product; prints JSON; says so when empty; maps 2000', async () => {
    await expectRejected(['list'], '--product');
    expect(JSON.parse((await trace(['list', '--product', '12', '--json'], page)).stdout).total).toBe(120);
    expect((await trace(['list', '--product', '12'], ok({ records: [], total: 0 }))).stdout).toContain('没有符合条件');
    expect((await trace(['list', '--product', '12'], bizError(2000, 'x'))).stderr).toContain('无权访问');
  });
});

describe('trace delete', () => {
  it('DELETEs /{id} with no confirmation prompt', async () => {
    const r = await trace(['delete', '5'], ok(null));
    expect(r.http.delete).toHaveBeenCalledWith('/forge/trace-links/5', undefined);
    expect(r.stdout).toContain('已删除: #5');
  });

  it('prints {deleted,id} with --json; maps 1002; rejects a bad id', async () => {
    expect(JSON.parse((await trace(['delete', '5', '--json'], ok(null))).stdout)).toEqual({ deleted: true, id: 5 });
    const r = await trace(['delete', '5'], bizError(1002, 'gone'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('不存在');
    await expectRejected(['delete', 'abc'], 'id');
  });
});
