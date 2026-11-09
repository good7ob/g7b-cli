import { afterEach, describe, expect, it, vi } from 'vitest';
import { Responder, bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { registerUcCommands } from '../index';
import { fmtRate, gapText } from '../render';

const uc = (args: string[], response: Responder = ok(null)) => runCli(registerUcCommands, ['uc', ...args], response);
const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; vi.restoreAllMocks(); });

const bucket = (priority: string, total: number, dist: Record<string, number>, usable: number, verified: number) => ({
  priority, total, distribution: { NOT_STARTED: 0, PARTIAL: 0, AVAILABLE: 0, VERIFIED: 0, ...dist },
  usable, verified, usableRate: total ? usable / total : null, verifiedRate: total ? verified / total : null,
});

const STATUS = {
  useCaseId: 5, code: 'UC-5', status: 'PARTIAL', statusLabel: '部分', usable: false,
  reasons: ['WEB 渠道未可达：缺入口声明', '未达已验证：缺测试用例'],
  channels: [
    { channel: 'WEB', reachable: false, reasons: [{ code: 'NO_ENTRY', label: '缺入口声明' }], entries: [] },
    { channel: 'API', reachable: true, reasons: [], entries: [{ entryId: 1, entryRef: 'POST /orgs', functionPointCode: 'fun-org-0001', functionPointName: '创建组织', reqStatus: 'REVIEWED', implStatus: 'COMPLETED', state: 'REACHABLE', stateLabel: '已可达' }] },
  ],
  gaps: [{ code: 'NO_ENTRY', label: '缺入口声明' }, { code: 'API_WITHOUT_UI', label: '有接口无界面' }],
  reachSummary: '已通：API；缺：Web',
  verification: { passed: false, missing: [{ code: 'TESTS', label: '缺测试用例' }, { code: 'DIAGRAMS', label: '流程图未渲染或已过期' }], testCaseCount: 0, testsPassed: 0, testsFailed: 0, testsNotRun: 0 },
  includes: [{ useCaseId: 6, code: 'UC-6', goal: '登录', status: 'NOT_STARTED', statusLabel: '未开始', usable: false }],
  functionPointCount: 1, diagramCount: 0, diagramStatus: 'NONE', diagramStatusLabel: '无流程图',
};

describe('rp-ucase-0071~0077 uc status', () => {
  it('shows status, per-channel reachability with reasons, gaps in Chinese, what verification lacks and include children', async () => {
    const r = await uc(['status', '5'], ok(STATUS));
    expect(r.http.get).toHaveBeenCalledWith('/use-cases/5/status', { params: undefined });
    expect(r.stdout).toContain('状态: 部分');
    expect(r.stdout).toContain('WEB 渠道未可达：缺入口声明');
    expect(r.stdout).toContain('WEB: ✗ 未可达（缺入口声明）');
    expect(r.stdout).toContain('API: ✓ 已可达');
    expect(r.stdout).toContain('POST /orgs  fun-org-0001 创建组织');
    expect(r.stdout).toContain('缺口: 缺入口声明、有接口无界面');
    expect(r.stdout).toContain('已通：API；缺：Web');
    expect(r.stdout).toContain('缺: 缺测试用例；流程图未渲染或已过期');
    expect(r.stdout).toContain('UC-6 登录  [未开始，未达可用]');
  });

  it('a verified use case has no gaps and shows verification as met; --json is the raw view', async () => {
    const verified = { ...STATUS, status: 'VERIFIED', statusLabel: '已验证', usable: true, reasons: [], gaps: [], reachSummary: null, verification: { passed: true, missing: [] }, includes: [] };
    const r = await uc(['status', '5'], ok(verified));
    expect(r.stdout).toContain('状态: 已验证（可用）');
    expect(r.stdout).toContain('缺口: 无');
    expect(r.stdout).toContain('测试与流程图均已满足');
    const raw = await uc(['status', '5', '--json'], ok(STATUS));
    expect(JSON.parse(raw.stdout)).toEqual(STATUS);
  });

  it('resolves UC-n through the product list', async () => {
    const r = await uc(['status', 'UC-5', '--product', '7'], (m, url) => (url === '/products/7/use-cases' ? ok({ records: [{ id: 5, seqNo: 5 }], pages: 1 }) : ok(STATUS)));
    expect(r.http.get).toHaveBeenNthCalledWith(2, '/use-cases/5/status', { params: undefined });
  });
});

describe('uc metrics', () => {
  const METRICS = {
    productId: 7, releaseId: null, milestoneId: null, total: 10,
    p0: bucket('P0', 4, { NOT_STARTED: 1, PARTIAL: 1, AVAILABLE: 1, VERIFIED: 1 }, 2, 1),
    p1: bucket('P1', 6, { AVAILABLE: 3, VERIFIED: 3 }, 6, 3),
    p2: bucket('P2', 0, {}, 0, 0),
    overall: bucket('ALL', 10, { NOT_STARTED: 1, PARTIAL: 1, AVAILABLE: 4, VERIFIED: 4 }, 8, 4),
  };

  it('calls the endpoint with the scope and leads with a highlighted P0 block', async () => {
    const r = await uc(['metrics', '--product', '7', '--release', '3', '--milestone', '4'], ok({ ...METRICS, releaseId: 3, milestoneId: 4 }));
    expect(r.http.get).toHaveBeenCalledWith('/products/7/use-case-metrics', { params: { releaseId: 3, milestoneId: 4 } });
    const out = r.stdout;
    expect(out).toContain('范围: Release 3，里程碑 4');
    expect(out.indexOf('★ P0')).toBeGreaterThan(-1);
    expect(out.indexOf('★ P0')).toBeLessThan(out.indexOf('P1'));
    expect(out).toContain('可用率 50%（可用或已验证 2/4）');
    expect(out).toContain('已验证率 25%（1/4）');
    expect(out).toContain('未开始 1 | 部分 1 | 可用 1 | 已验证 1');
    expect(out).toContain('合计');
  });

  it('shows 「—」 for a null rate (total 0), never 0%, but still shows the four-status distribution as zeros', async () => {
    const r = await uc(['metrics', '--product', '7'], ok(METRICS));
    expect(r.stdout).toMatch(/P2\s+0\s+0\s+—\s+—\s+未开始 0 \| 部分 0 \| 可用 0 \| 已验证 0/);
    expect(r.stdout).not.toMatch(/(^|[^\d.])0%/); // 50% / 100% are fine, a bare 0% is not
    const noP0 = await uc(['metrics', '--product', '7'], ok({ ...METRICS, total: 0, p0: bucket('P0', 0, {}, 0, 0) }));
    expect(noP0.stdout).toContain('可用率 —（可用或已验证 0/0）');
    expect(noP0.stdout).not.toMatch(/(^|[^\d.])0%/);
  });

  it.each([
    [null, '—'], [undefined, '—'], [0, '0%'], [0.5, '50%'], [1, '100%'], [2 / 3, '66.7%'], [0.125, '12.5%'],
  ])('fmtRate(%s) = %s', (rate, text) => expect(fmtRate(rate as number | null)).toBe(text));

  it('needs a product, validates --release before any request, and defaults to the whole product', async () => {
    delete process.env.GOOD7OB_PRODUCT_ID;
    expect(noHttpCalls(await uc(['metrics']))).toBe(true);
    expect(noHttpCalls(await uc(['metrics', '--product', '7', '--release', 'x']))).toBe(true);
    const r = await uc(['metrics', '--product', '7'], ok(METRICS));
    expect(r.stdout).toContain('范围: 全产品');
  });
});

describe('uc gaps', () => {
  it('lists the P0 gap use cases with gap marks and the reach summary', async () => {
    const rows = [
      { id: 5, code: 'UC-5', goal: '邀请成员', priority: 'P0', status: 'PARTIAL', statusLabel: '部分', gaps: [{ code: 'NO_ENTRY', label: '缺入口声明' }, { code: 'NO_TEST_CASE', label: '缺测试用例' }], reachSummary: '已通：API；缺：Web' },
      { id: 6, code: 'UC-6', goal: '登录', priority: 'P0', status: 'NOT_STARTED', statusLabel: '未开始', gaps: [{ code: 'NO_FUNCTION_POINT', label: '未关联 FP' }], reachSummary: null },
    ];
    const r = await uc(['gaps', '--product', '7', '--release', '3'], ok(rows));
    expect(r.http.get).toHaveBeenCalledWith('/products/7/use-case-gaps', { params: { releaseId: 3 } });
    expect(r.stdout).toContain('共 2 条');
    expect(r.stdout).toContain('缺入口声明、缺测试用例');
    expect(r.stdout).toContain('未关联 FP');
    expect(r.stdout).toContain('已通：API；缺：Web');
    expect((await uc(['gaps', '--product', '7'], ok([]))).stdout).toContain('没有P0 缺口用例');
  });
});

describe('uc list status / gap / scope / sort', () => {
  const ROW = { id: 5, code: 'UC-5', goal: '邀请', priority: 'P0', actorName: 'A', channels: ['WEB'], functionPointCount: 1, status: 'PARTIAL', statusLabel: '部分', gaps: [{ code: 'NO_ENTRY', label: '缺入口声明' }, { code: 'NO_DIAGRAM', label: '缺流程图' }], diagramStatus: 'NONE', diagramStatusLabel: '无流程图' };

  it.each([
    [['--status', 'partial,not_started'], { status: 'PARTIAL,NOT_STARTED' }],
    [['--status', 'verified,verified'], { status: 'VERIFIED' }],
    [['--gap', 'no_entry,test_failed'], { gap: 'NO_ENTRY,TEST_FAILED' }],
    [['--release', '3', '--milestone', '4'], { releaseId: 3, milestoneId: 4 }],
    [['--sort', 'STATUS', '--order', 'DESC'], { sort: 'status', order: 'desc' }],
    [['--sort', 'priority'], { sort: 'priority' }],
  ])('passes %j through as %j', async (flags, expected) => {
    const r = await uc(['list', '--product', '7', ...flags], ok({ records: [ROW], total: 1, current: 1, pages: 1 }));
    expect(r.http.get).toHaveBeenCalledWith('/products/7/use-cases', { params: expected });
  });

  it('shows the derived status, gap marks and picture state on each row', async () => {
    const r = await uc(['list', '--product', '7'], ok({ records: [ROW], total: 1, current: 1, pages: 1 }));
    expect(r.stdout).toMatch(/UC-5\s+P0\s+部分/);
    expect(r.stdout).toContain('缺入口声明、缺流程图');
    expect(r.stdout).toContain('无流程图');
  });

  it.each([
    [['--status', 'done']], [['--gap', 'oops']], [['--sort', 'name']], [['--order', 'up']], [['--release', 'abc']],
  ])('rejects %j before any request', async (flags) => {
    const r = await uc(['list', '--product', '7', ...flags]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('参数错误');
    expect(noHttpCalls(r)).toBe(true);
  });
});

describe('rp-ucase-0071 15014: too many use cases to derive', () => {
  const tooMany = bizError(15014, '范围内用例过多，无法实时计算状态，请先缩小范围（2500 > 2000）');
  it.each([
    [['list', '--product', '7', '--status', 'partial']],
    [['metrics', '--product', '7']],
    [['gaps', '--product', '7']],
  ])('%j tells the user to narrow the scope and keeps the server count', async (args) => {
    const r = await uc(args, tooMany);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('缩小范围');
    expect(r.stderr).toContain('--release');
    expect(r.stderr).toContain('2500 > 2000');
  });
});

describe('gapText', () => {
  it.each([
    [undefined, '无'], [[], '无'],
    [[{ code: 'NO_ENTRY', label: '缺入口声明' }], '缺入口声明'],
    [[{ code: 'TEST_FAILED', label: '测试失败' }, { code: 'TEST_NOT_RUN', label: '测试未执行' }], '测试失败、测试未执行'],
  ])('%j -> %s', (gaps, text) => expect(gapText(gaps as never)).toBe(text));
});
