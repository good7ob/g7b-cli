import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerHealthCommands } from '../index';
import { parseCurrency, parseIncurredOn, parseMoney } from '../costInput';
import { bizError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerHealthCommands(program.command('pm'));
const health = (args: string[], response = ok(null)) => runCli(register, ['pm', 'health', ...args], response);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-19T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function expectRejected(args: string[], needle: string) {
  const r = await health(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const cost = {
  productId: 12, releaseId: null, weightBasis: 'ESTIMATED_HOURS', status: 'OK', message: null, currency: 'CNY',
  budget: { configured: true, amount: 10000000 },
  actual: { byCategory: { labor: 0, cloud: 1500000, ai_token: 0, other: 5000000 }, manualTotal: 6500000, derivedLabor: { derived: true, hours: 120, ratePerHour: 200, amount: 24000 }, total: 6524000 },
  remainingBudget: 3476000, costProgressPct: 65.24, developmentProgressPct: 56, timeProgressPct: 70, costVarianceVsProgress: 9.24,
  costPerScopeUnit: 116500, estimateAtCompletion: 11607142.86, estimateVariance: 1607142.86, aiTokensConsumed: 123456, warnings: ['手工 labor 条目与推导人力并存，可能重复计入'],
};

describe('pm health cost <productId>', () => {
  it('GETs (with --release) and renders budget, actuals, derived labor, the three progress lines and EAC', async () => {
    const r = await health(['cost', '12', '--release', '5'], ok(cost));
    expect(r.http.get).toHaveBeenCalledWith('/progress/products/12/cost', { params: { releaseId: 5 } });
    expect(r.stdout).toMatch(/预算\s+10000000\.00/);
    expect(r.stdout).toMatch(/实际合计\s+6524000\.00/);
    expect(r.stdout).toMatch(/剩余预算\s+3476000\.00/);
    expect(r.stdout).toMatch(/cloud 云资源\s+1500000\.00/);
    expect(r.stdout).toMatch(/ai_token AI token\s+0\.00/);
    expect(r.stdout).toContain('推导人力（非手工录入）  120 小时 × 200.00 /小时 = 24000.00');
    expect(r.stdout).toMatch(/开发进度\s+56%/);
    expect(r.stdout).toMatch(/成本进度\s+65\.2%/);
    expect(r.stdout).toMatch(/成本偏差\s+9\.2 个百分点（正 = 成本消耗快于交付）/);
    expect(r.stdout).toMatch(/完工估算 \(EAC\)\s+11607142\.86/);
    expect(r.stdout).toContain('AI token 消耗量 123456（token 数量，不是金额');
    expect(r.stdout).toContain('⚠ 手工 labor 条目与推导人力并存');
  });

  it('NO_BUDGET keeps the actuals, shows — for the ratios and explains how to set a budget', async () => {
    const out = (await health(['cost', '12'], ok({
      ...cost, status: 'NO_BUDGET', budget: null, remainingBudget: null, costProgressPct: null, costVarianceVsProgress: null, estimateAtCompletion: null,
      estimateVariance: null, costPerScopeUnit: null, actual: { ...cost.actual, derivedLabor: null, total: 6500000 }, warnings: [],
    }))).stdout;
    expect(out).toContain('状态 NO_BUDGET');
    expect(out).toContain('该范围没有预算');
    expect(out).toMatch(/预算\s+未设置/);
    expect(out).toMatch(/剩余预算\s+—/);
    expect(out).toMatch(/成本进度\s+—/);
    expect(out).toMatch(/完工估算 \(EAC\)\s+—/);
    expect(out).toMatch(/手工合计\s+6500000\.00/);
    expect(out).not.toContain('推导人力');
  });

  it('INSUFFICIENT_DATA (mixed currencies): nothing is summed, everything —', async () => {
    const out = (await health(['cost', '12'], ok({ productId: 12, status: 'INSUFFICIENT_DATA', message: '同一范围出现多个币种', currency: null, budget: null, actual: null, warnings: ['范围内出现多个币种'] }))).stdout;
    expect(out).toContain('数据不足：同一范围出现多个币种');
    expect(out).toMatch(/实际合计\s+—/);
    expect(out).not.toContain('手工合计');
    expect(out).toContain('⚠ 范围内出现多个币种');
  });

  it('keeps a real 0 (no AI tokens, zero cost) and survives an empty body / --json', async () => {
    expect((await health(['cost', '12'], ok({ ...cost, aiTokensConsumed: 0, costProgressPct: 0 }))).stdout).toMatch(/AI token 消耗量 0（/);
    expect((await health(['cost', '12'], ok(null))).exitCode).toBeUndefined();
    expect(JSON.parse((await health(['cost', '12', '--json'], ok(cost))).stdout).costProgressPct).toBe(65.24);
  });

  it.each([[['cost', 'x'], 'productId'], [['cost', '12', '--release', '0'], '--release']])('rejects %j locally', (args, n) => expectRejected(args, n));
  it.each([[1002, '不存在'], [2000, '组织的成员']])('maps business error %i', async (code, text) => {
    expect((await health(['cost', '12'], bizError(code))).stderr).toContain(text);
  });
});

describe('pm health budget', () => {
  const budget = { configured: true, id: 3, productId: 12, releaseId: null, amount: 10000, currency: 'CNY', laborRatePerHour: 200, note: '2026 H2', updatedBy: 11, updatedAt: '2026-09-19T10:00:00' };

  it('get: GET with / without --release; unset renders a hint, set renders the fields', async () => {
    expect((await health(['budget', 'get', '12'], ok(budget))).http.get).toHaveBeenCalledWith('/progress/products/12/budget', { params: {} });
    const rel = await health(['budget', 'get', '12', '--release', '5'], ok({ configured: false }));
    expect(rel.http.get).toHaveBeenCalledWith('/progress/products/12/budget', { params: { releaseId: 5 } });
    expect(rel.stdout).toContain('Release #5没有设置预算');
    const out = (await health(['budget', 'get', '12'], ok(budget))).stdout;
    expect(out).toMatch(/金额\s+10000\.00 CNY/);
    expect(out).toMatch(/人力费率\s+200\.00 CNY \/小时/);
    expect(out).toMatch(/备注\s+2026 H2/);
    expect((await health(['budget', 'get', '12'], ok(null))).stdout).toContain('没有设置预算');
  });

  it('set: PUTs amount / upper-cased currency / labor rate / note / release', async () => {
    const r = await health(['budget', 'set', '12', '--amount', '10000.5', '--currency', 'cny', '--labor-rate', '200', '--note', ' 2026 H2 ', '--release', '5'], ok(budget));
    expect(r.http.put).toHaveBeenCalledWith('/progress/products/12/budget', { amount: 10000.5, currency: 'CNY', laborRatePerHour: 200, note: '2026 H2', releaseId: 5 });
    expect(r.stdout).toContain('✓ 已保存');
  });

  it('set: only amount + currency are sent when nothing else is given (blank note dropped)', async () => {
    const r = await health(['budget', 'set', '12', '--amount', '1', '--currency', 'USD', '--note', '  '], ok(budget));
    expect(r.http.put).toHaveBeenCalledWith('/progress/products/12/budget', { amount: 1, currency: 'USD' });
  });

  it('set: requires --amount and --currency', async () => {
    for (const args of [['budget', 'set', '12', '--currency', 'CNY'], ['budget', 'set', '12', '--amount', '5']]) {
      const r = await health(args);
      expect(r.exitCode).toBe(1);
      expect(noHttpCalls(r)).toBe(true);
    }
  });

  it.each([
    [['--amount', '0', '--currency', 'CNY'], '--amount'],
    [['--amount', '-5', '--currency', 'CNY'], '--amount'],
    [['--amount', '1.234', '--currency', 'CNY'], '--amount'],
    [['--amount', '10000000000', '--currency', 'CNY'], '--amount'],
    [['--amount', 'abc', '--currency', 'CNY'], '--amount'],
    [['--amount', '5', '--currency', 'RMBX'], '--currency'],
    [['--amount', '5', '--currency', 'C1Y'], '--currency'],
    [['--amount', '5', '--currency', 'CNY', '--labor-rate', '0'], '--labor-rate'],
    [['--amount', '5', '--currency', 'CNY', '--labor-rate', '100000.01'], '--labor-rate'],
    [['--amount', '5', '--currency', 'CNY', '--note', 'x'.repeat(501)], '--note'],
    [['--amount', '5', '--currency', 'CNY', '--release', 'x'], '--release'],
  ])('set: rejects %j locally', (flags, needle) => expectRejected(['budget', 'set', '12', ...flags], needle));

  it('set: accepts the boundaries (9999999999.99, 0.01, rate 100000, note of 500 chars)', async () => {
    const r = await health(['budget', 'set', '12', '--amount', '9999999999.99', '--currency', 'CNY', '--labor-rate', '100000', '--note', 'x'.repeat(500)], ok(budget));
    expect(r.exitCode).toBeUndefined();
    expect((await health(['budget', 'set', '12', '--amount', '0.01', '--currency', 'CNY'], ok(budget))).exitCode).toBeUndefined();
  });

  it('clear: DELETEs (release as a query string) without any confirmation', async () => {
    const product = await health(['budget', 'clear', '12'], ok(true));
    expect(product.http.delete).toHaveBeenCalledWith('/progress/products/12/budget', undefined);
    expect(product.stdout).toContain('已删除预算: 产品 #12（产品级）');
    const rel = await health(['budget', 'clear', '12', '--release', '5', '--json'], ok(true));
    expect(rel.http.delete).toHaveBeenCalledWith('/progress/products/12/budget?releaseId=5', undefined);
    expect(JSON.parse(rel.stdout)).toEqual({ productId: 12, releaseId: 5, deleted: true });
    await expectRejected(['budget', 'clear', '12', '--release', 'x'], '--release');
  });

  it.each([[1001, '币种'], [1002, '不存在'], [2000, 'owner/admin']])('maps business error %i (set)', async (code, text) => {
    const r = await health(['budget', 'set', '12', '--amount', '5', '--currency', 'CNY'], bizError(code, 'srv'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('设置预算失败');
    expect(r.stderr).toContain(text);
  });
});

describe('pm health cost-entry', () => {
  const entry = { id: 9, productId: 12, releaseId: 5, category: 'cloud', amount: 1200.5, currency: 'CNY', incurredOn: '2026-09-01', note: 'EKS', source: 'manual' };
  const add = ['cost-entry', 'add', '12', '--category', 'cloud', '--amount', '1200.50', '--currency', 'cny', '--date', '2026-09-01'];

  it('list: GETs with default paging, all filters, and renders the table (auto entries marked read-only)', async () => {
    const page = { records: [entry, { ...entry, id: 8, releaseId: null, category: 'labor', note: null, source: 'auto' }], total: 23, current: 1, size: 20, pages: 2 };
    const r = await health(['cost-entry', 'list', '12'], ok(page));
    expect(r.http.get).toHaveBeenCalledWith('/progress/products/12/cost-entries', { params: { pageNum: 1, pageSize: 20 } });
    expect(r.stdout).toMatch(/9\s+2026-09-01\s+cloud 云资源\s+1200\.50\s+CNY\s+5\s+manual\s+EKS/);
    expect(r.stdout).toMatch(/8\s+2026-09-01\s+labor 人力\s+1200\.50\s+CNY\s+—\s+auto\s+—/);
    expect(r.stdout).toContain('共 23 条，第 1/2 页（source=auto 的条目只读）');
    const f = await health(['cost-entry', 'list', '12', '--category', 'AI_TOKEN', '--release', '5', '--from', '2026-09-01', '--to', '2026-09-30', '-p', '2', '--page-size', '100'], ok(page));
    expect(f.http.get).toHaveBeenCalledWith('/progress/products/12/cost-entries', { params: { pageNum: 2, pageSize: 100, releaseId: 5, category: 'ai_token', from: '2026-09-01', to: '2026-09-30' } });
  });

  it('list: empty page / null body / --json', async () => {
    expect((await health(['cost-entry', 'list', '12'], ok({ records: [], total: 0 }))).stdout).toContain('没有成本条目');
    expect((await health(['cost-entry', 'list', '12'], ok(null))).stdout).toContain('没有成本条目');
    expect(JSON.parse((await health(['cost-entry', 'list', '12', '--json'], ok({ records: [entry], total: 1 }))).stdout).total).toBe(1);
  });

  it.each([
    [['--category', 'food'], '--category'],
    [['--from', '2026-13-01'], '--from'],
    [['--to', '20260901'], '--to'],
    [['--from', '2026-09-30', '--to', '2026-09-01'], '不能晚于'],
    [['--page', '0'], '--page'],
    [['--page-size', '101'], '--page-size'],
    [['--release', 'x'], '--release'],
  ])('list: rejects %j locally', (flags, needle) => expectRejected(['cost-entry', 'list', '12', ...flags], needle));

  it('add: POSTs the normalized body and renders the entry', async () => {
    const r = await health([...add, '--release', '5', '--note', 'EKS'], ok(entry));
    expect(r.http.post).toHaveBeenCalledWith('/progress/products/12/cost-entries', { category: 'cloud', amount: 1200.5, currency: 'CNY', incurredOn: '2026-09-01', note: 'EKS', releaseId: 5 });
    expect(r.stdout).toContain('✓ 成本条目已记录  #9');
    expect(r.stdout).toMatch(/金额\s+1200\.50 CNY/);
    expect(r.stdout).toMatch(/范围\s+Release #5/);
  });

  it('add: category is case-insensitive; the four categories are accepted', async () => {
    for (const c of ['LABOR', 'Cloud', 'ai_token', 'other']) {
      const r = await health(['cost-entry', 'add', '12', '--category', c, '--amount', '1', '--currency', 'CNY', '--date', '2026-09-01'], ok(entry));
      expect(r.http.post.mock.calls[0][1].category).toBe(c.toLowerCase());
    }
  });

  it('add: requires category / amount / currency / date', async () => {
    for (const drop of ['--category', '--amount', '--currency', '--date']) {
      const args = [...add];
      args.splice(args.indexOf(drop), 2);
      const r = await health(args);
      expect(r.exitCode).toBe(1);
      expect(noHttpCalls(r)).toBe(true);
    }
  });

  it.each([
    [['--category', 'food'], '--category'],
    [['--amount', '0'], '--amount'],
    [['--amount', '12.345'], '--amount'],
    [['--amount', '10000000000'], '--amount'],
    [['--currency', 'CN'], '--currency'],
    [['--date', '2026-02-30'], '--date'],
    [['--date', '1999-12-31'], '--date'],
    [['--date', '2026-09-21'], '--date'],
    [['--date', '09/01/2026'], '--date'],
    [['--note', 'x'.repeat(501)], '--note'],
    [['--release', 'x'], '--release'],
  ])('add: rejects %j locally', async (flags, needle) => {
    // replace the flag's value when `add` already carries it, otherwise append the pair
    const args = [...add];
    const at = args.indexOf(flags[0]);
    if (at < 0) args.push(...flags);
    else args.splice(at, 2, ...flags);
    await expectRejected(args, needle);
  });

  it('add: today, tomorrow (UTC) and 2000-01-01 are accepted', async () => {
    for (const d of ['2000-01-01', '2026-09-19', '2026-09-20']) {
      expect((await health([...add.slice(0, -1), d], ok(entry))).exitCode).toBeUndefined();
    }
  });

  it('update: PUTs the whole entry to /progress/cost-entries/{id}', async () => {
    const r = await health(['cost-entry', 'update', '9', '--category', 'other', '--amount', '5', '--currency', 'CNY', '--date', '2026-09-02'], ok(entry));
    expect(r.http.put).toHaveBeenCalledWith('/progress/cost-entries/9', { category: 'other', amount: 5, currency: 'CNY', incurredOn: '2026-09-02' });
    expect(r.stdout).toContain('✓ 成本条目已更新  #9');
    await expectRejected(['cost-entry', 'update', 'x', '--category', 'other', '--amount', '5', '--currency', 'CNY', '--date', '2026-09-02'], 'id');
    const missing = await health(['cost-entry', 'update', '9', '--category', 'other']);
    expect(missing.exitCode).toBe(1);
    expect(noHttpCalls(missing)).toBe(true);
  });

  it('delete: DELETEs, no confirmation; --json', async () => {
    const r = await health(['cost-entry', 'delete', '9'], ok(true));
    expect(r.http.delete).toHaveBeenCalledWith('/progress/cost-entries/9', undefined);
    expect(r.stdout).toContain('✓ 成本条目 #9 已删除');
    expect(JSON.parse((await health(['cost-entry', 'delete', '9', '--json'], ok(true))).stdout)).toEqual({ id: 9, deleted: true });
    await expectRejected(['cost-entry', 'delete', '0'], 'id');
  });

  it.each([['update', 1007], ['delete', 1007]])('%s: an auto entry answers 1007 with a readable reason', async (verb, code) => {
    const args = verb === 'update'
      ? ['cost-entry', 'update', '9', '--category', 'other', '--amount', '5', '--currency', 'CNY', '--date', '2026-09-02']
      : ['cost-entry', 'delete', '9'];
    const r = await health(args, bizError(code, '自动入账的成本条目不可修改或删除'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('source=auto');
    expect(r.stderr).toContain('[1007');
  });

  it.each([[1001, '币种'], [1002, '不存在'], [2000, 'owner/admin']])('add: maps business error %i', async (code, text) => {
    const r = await health(add, bizError(code, 'srv'));
    expect(r.stderr).toContain('记录成本条目失败');
    expect(r.stderr).toContain(text);
  });
});

describe('cost input helpers', () => {
  it('parseMoney', () => {
    expect(parseMoney(' 12.5 ', '--amount', 100)).toBe(12.5);
    expect(() => parseMoney('100.01', '--amount', 100)).toThrow('不超过 100');
    expect(() => parseMoney('0.00', '--amount', 100)).toThrow('大于 0');
    expect(() => parseMoney(undefined, '--amount', 100)).toThrow('(空)');
    expect(() => parseMoney('1,5', '--amount', 100)).toThrow();
  });

  it('parseCurrency', () => {
    expect(parseCurrency(' usd ')).toBe('USD');
    expect(() => parseCurrency('')).toThrow('3 位字母');
    expect(() => parseCurrency(undefined)).toThrow('3 位字母');
  });

  it('parseIncurredOn takes an injected clock: tomorrow (UTC) is the last valid day', () => {
    const now = new Date('2026-09-19T23:30:00Z');
    expect(parseIncurredOn('2026-09-20', now)).toBe('2026-09-20');
    expect(() => parseIncurredOn('2026-09-21', now)).toThrow('明天，UTC');
    expect(() => parseIncurredOn(undefined, now)).toThrow('必填');
  });
});
