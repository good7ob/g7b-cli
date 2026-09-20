import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import apiClient from '../../../../services/ApiClient';
import { registerHealthCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerHealthCommands(program.command('pm'));
const health = (args: string[], response = ok(null)) => runCli(register, ['pm', 'health', ...args], response);

afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await health(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const forecast = {
  productId: 12, releaseId: null, weightBasis: 'ESTIMATED_HOURS', status: 'OK', message: null, asOfDate: '2026-09-19',
  remainingScope: 500, sampleWeeks: 8, activeWeeks: 7, iterations: 2000, horizonWeeks: 520,
  p50Weeks: 10, p80Weeks: 11.5, p50Date: '2026-11-28', p80Date: '2026-12-08', notConverging: false,
  plannedEndDate: '2026-11-15', p50VarianceDays: 13, p80VarianceDays: -3,
  samples: [{ weekStart: '2026-07-27', completed: 50 }, { weekStart: '2026-08-03', completed: 0 }, { weekStart: '2026-08-10', completed: 100 }],
};

describe('pm health forecast <productId>', () => {
  it('GETs with no params by default and with --release', async () => {
    expect((await health(['forecast', '12'], ok(forecast))).http.get).toHaveBeenCalledWith('/progress/products/12/forecast', { params: {} });
    const r = await health(['forecast', '12', '--release', '5'], ok(forecast));
    expect(r.http.get).toHaveBeenCalledWith('/progress/products/12/forecast', { params: { releaseId: 5 } });
  });

  it('renders P50 / P80 dates, weeks and the variance against the plan', async () => {
    const out = (await health(['forecast', '12'], ok(forecast))).stdout;
    expect(out).toContain('截至 2026-09-19');
    expect(out).toMatch(/预计完成日期\s+2026-11-28\s+2026-12-08/);
    expect(out).toMatch(/还需周数\s+10\s+11\.5/);
    expect(out).toMatch(/相对计划\s+晚 13 天\s+早 3 天/);
    expect(out).toMatch(/计划结束\s+2026-11-15/);
    expect(out).toMatch(/周完成量\s+\S{3}\s+\(max 100, 3 周/);
    expect(out).toContain('ESTIMATED_HOURS (h)');
  });

  it('INSUFFICIENT_DATA says 数据不足 and never shows a date', async () => {
    const data = { ...forecast, status: 'INSUFFICIENT_DATA', message: '可度量周不足 4 周', p50Weeks: null, p80Weeks: null, p50Date: null, p80Date: null, p50VarianceDays: null, p80VarianceDays: null };
    const out = (await health(['forecast', '12'], ok(data))).stdout;
    expect(out).toContain('数据不足，不给预测日期：可度量周不足 4 周');
    expect(out).toMatch(/预计完成日期\s+数据不足\s+数据不足/);
    expect(out).toMatch(/还需周数\s+数据不足\s+数据不足/);
    expect(out).toMatch(/相对计划\s+—\s+—/);
  });

  it('even a (bogus) date on an INSUFFICIENT_DATA answer is not shown', async () => {
    const out = (await health(['forecast', '12'], ok({ ...forecast, status: 'INSUFFICIENT_DATA' }))).stdout;
    expect(out).toMatch(/预计完成日期\s+数据不足\s+数据不足/);
    expect(out).not.toContain('2026-11-28');
  });

  it('a quantile that never converges is 不收敛, a plain null is —', async () => {
    const out = (await health(['forecast', '12'], ok({ ...forecast, notConverging: true, p80Weeks: null, p80Date: null }))).stdout;
    expect(out).toMatch(/预计完成日期\s+2026-11-28\s+不收敛/);
    expect(out).toContain('520 周内无法完成');
    const plain = (await health(['forecast', '12'], ok({ ...forecast, p80Weeks: null, p80Date: null, plannedEndDate: null, p50VarianceDays: null, p80VarianceDays: null }))).stdout;
    expect(plain).toMatch(/预计完成日期\s+2026-11-28\s+—/);
    expect(plain).toMatch(/计划结束\s+—/);
  });

  it('keeps a real 0 (nothing left to do): 0 weeks, on plan', async () => {
    const out = (await health(['forecast', '12'], ok({ ...forecast, remainingScope: 0, p50Weeks: 0, p80Weeks: 0, p50VarianceDays: 0, p80VarianceDays: 0, samples: [] }))).stdout;
    expect(out).toMatch(/剩余范围\s+0/);
    expect(out).toMatch(/还需周数\s+0\s+0/);
    expect(out).toMatch(/相对计划\s+与计划持平\s+与计划持平/);
    expect(out).not.toContain('周完成量');
  });

  it('survives an empty body and prints --json (before or after the subcommand)', async () => {
    expect((await health(['forecast', '12'], ok(null))).exitCode).toBeUndefined();
    expect(JSON.parse((await health(['forecast', '12', '--json'], ok(forecast))).stdout).p50Weeks).toBe(10);
    expect(JSON.parse((await health(['--json', 'forecast', '12'], ok(forecast))).stdout).p50Weeks).toBe(10);
  });

  it.each([[['forecast', 'abc'], 'productId'], [['forecast', '0'], 'productId'], [['forecast', '12', '--release', 'x'], '--release']])(
    'rejects %j locally', async (args, needle) => expectRejected(args, needle));

  it.each([[1001, 'Release 不属于该产品'], [1002, '不存在'], [2000, '组织的成员']])('maps business error %i', async (code, text) => {
    const r = await health(['forecast', '12'], bizError(code, 'srv'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('获取完成预测失败');
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain(`[${code}: srv]`);
  });
});

const scenario = (over = {}) => ({ remaining: 500, velocity: 50, p50Weeks: 10, p80Weeks: 10, p50Date: '2026-11-28', p80Date: '2026-11-28', notConverging: false, estimateAtCompletion: null, ...over });
const whatIf = {
  productId: 12, releaseId: null, weightBasis: 'STORY_POINT', status: 'OK', message: null,
  baseline: scenario(), scenario: scenario({ remaining: 600, p50Weeks: 12, p80Weeks: 12, p50Date: '2026-12-12', p80Date: '2026-12-12' }),
  deltaDays: 14, deltaDaysP80: 14, deadline: '2026-12-01', meetsDeadline: { p50: false, p80: false }, baselineMeetsDeadline: { p50: true, p80: null },
  costImpact: { currency: 'CNY', baselineEstimateAtCompletion: 1000, scenarioEstimateAtCompletion: 1200.5, delta: 200.5 }, warnings: ['新增产能的成本未计入'],
};

describe('pm health what-if <productId>', () => {
  it('POSTs the scenario with numbers, the release and the deadline', async () => {
    const r = await health(['what-if', '12', '--add-scope', '100', '--remove-scope', '20.5', '--velocity-multiplier', '1.5', '--extra-capacity', '10', '--deadline', '2026-12-01', '--release', '5'], ok(whatIf));
    expect(r.http.post).toHaveBeenCalledWith('/progress/products/12/what-if', {
      releaseId: 5, addScope: 100, removeScope: 20.5, velocityMultiplier: 1.5, extraWeeklyCapacity: 10, deadline: '2026-12-01',
    });
    expect(r.exitCode).toBeUndefined();
  });

  it('no flag at all sends an empty body (scenario = baseline; the backend answers with a warning)', async () => {
    const r = await health(['what-if', '12'], ok(whatIf));
    expect(r.http.post).toHaveBeenCalledWith('/progress/products/12/what-if', {});
  });

  it('accepts every documented boundary value', async () => {
    const r = await health(['what-if', '12', '--add-scope', '1000000000', '--remove-scope', '0', '--velocity-multiplier', '0.1', '--extra-capacity', '1000000', '--deadline', '2100-01-01'], ok(whatIf));
    expect(r.exitCode).toBeUndefined();
    expect((await health(['what-if', '12', '--velocity-multiplier', '10', '--deadline', '2000-01-01'], ok(whatIf))).exitCode).toBeUndefined();
  });

  it.each([
    [['--add-scope', '-1'], '--add-scope'],
    [['--add-scope', '1000000001'], '--add-scope'],
    [['--add-scope', 'abc'], '--add-scope'],
    [['--add-scope', '1e3'], '--add-scope'],
    [['--remove-scope', '1000000000.5'], '--remove-scope'],
    [['--velocity-multiplier', '0.09'], '--velocity-multiplier'],
    [['--velocity-multiplier', '10.01'], '--velocity-multiplier'],
    [['--velocity-multiplier', '0'], '--velocity-multiplier'],
    [['--extra-capacity', '1000001'], '--extra-capacity'],
    [['--deadline', '1999-12-31'], '--deadline'],
    [['--deadline', '2100-01-02'], '--deadline'],
    [['--deadline', '2026-02-30'], '--deadline'],
    [['--deadline', '12/01/2026'], '--deadline'],
    [['--release', '0'], '--release'],
  ])('rejects %j locally', async (flags, needle) => expectRejected(['what-if', '12', ...flags], needle));

  it('renders baseline vs scenario, the shift, the deadline verdict, cost impact and warnings', async () => {
    const out = (await health(['what-if', '12', '--add-scope', '100'], ok(whatIf))).stdout;
    expect(out).toContain('STORY_POINT (SP)');
    expect(out).toMatch(/剩余范围\s+500\s+600/);
    expect(out).toMatch(/P50 完成\s+2026-11-28\s+2026-12-12/);
    expect(out).toContain('P50 延后 14 天');
    expect(out).toContain('目标日期 2026-12-01');
    expect(out).toMatch(/基线 P50 ✓ 赶得上 {2}P80 —/);
    expect(out).toMatch(/场景 P50 ✗ 赶不上 {2}P80 ✗ 赶不上/);
    expect(out).toMatch(/基线完工估算\s+1000/);
    expect(out).toMatch(/场景完工估算\s+1200\.5/);
    expect(out).toContain('⚠ 新增产能的成本未计入');
    expect(out).toContain('不会保存任何数据');
  });

  it('says 提前 for a negative delta and 不变 for 0; no deadline / costImpact rows when absent', async () => {
    const out = (await health(['what-if', '12', '--velocity-multiplier', '2'], ok({ ...whatIf, deltaDays: -21, deltaDaysP80: 0, deadline: null, costImpact: null, warnings: [] }))).stdout;
    expect(out).toContain('P50 提前 21 天    P80 不变');
    expect(out).not.toContain('目标日期');
    expect(out).not.toContain('成本影响');
  });

  it('INSUFFICIENT_DATA shows 数据不足 for both scenarios and — for the deltas', async () => {
    const empty = { remaining: 500, velocity: null, p50Weeks: null, p80Weeks: null, p50Date: null, p80Date: null, notConverging: false };
    const out = (await health(['what-if', '12'], ok({ ...whatIf, status: 'INSUFFICIENT_DATA', message: '历史不足', baseline: empty, scenario: empty, deltaDays: null, deltaDaysP80: null, meetsDeadline: null, baselineMeetsDeadline: null, costImpact: null }))).stdout;
    expect(out).toContain('数据不足，不给预测日期：历史不足');
    expect(out).toMatch(/P50 完成\s+数据不足\s+数据不足/);
    expect(out).toContain('P50 —    P80 —');
    expect(out).toMatch(/基线 P50 —  P80 —/);
  });

  it('prints --json and maps 1001', async () => {
    expect(JSON.parse((await health(['what-if', '12', '--json'], ok(whatIf))).stdout).deltaDays).toBe(14);
    const r = await health(['what-if', '12'], bizError(1001, 'addScope 必须在 [0.0, 1.0E9] 内'));
    expect(r.stderr).toContain('What-if 模拟失败');
    expect(r.stderr).toContain('addScope 必须在');
  });
});

const diagnosis = {
  productId: 12, releaseId: null, weightBasis: 'ESTIMATED_HOURS', asOfDate: '2026-09-19', overallSeverity: 'CRITICAL',
  findings: [
    { severity: 'CRITICAL', code: 'VELOCITY_DECLINE', message: '最近 4 周速度 25.00 比之前 4 周 50.00 下降 50.0%', data: {} },
    { severity: 'INFO', code: 'COST_NO_BUDGET', message: '没有预算', data: null },
  ],
  facts: {
    scope: { scope: 1300, completed: 600, remaining: 700, weightedProgress: 50 }, schedule: { plannedEndDate: '2026-11-15', timeProgressPct: 70 },
    weightedDelayDays: 4, velocity: { recentAvg: 25, previousAvg: 50, changePct: -50, trend: 'DECLINING' }, blocked: { blockedRatioPct: 11.4 },
    scopeGrowth: { growthPctOfBaseline: 30, netDelta: 300, impactDays: 42 },
    modules: [{ projectId: 3, moduleName: 'Login', delayDays: 6, weightSharePct: 50, contributionDays: 3, sharePct: 75, blockedTasks: 1 }],
  },
};

describe('pm health diagnosis <productId>', () => {
  it('GETs (with --release) and renders findings, facts and modules', async () => {
    const r = await health(['diagnosis', '12', '--release', '5'], ok(diagnosis));
    expect(r.http.get).toHaveBeenCalledWith('/progress/products/12/diagnosis', { params: { releaseId: 5 } });
    expect(r.stdout).toContain('总体 严重 (CRITICAL)');
    expect(r.stdout).toMatch(/CRITICAL\s+VELOCITY_DECLINE\s+最近 4 周速度/);
    expect(r.stdout).toMatch(/INFO\s+COST_NO_BUDGET/);
    expect(r.stdout).toMatch(/加权进度\s+50%/);
    expect(r.stdout).toMatch(/速度趋势\s+下降（近期 25 \/ 此前 50，-50%）/);
    expect(r.stdout).toMatch(/Login\s+6\s+50%\s+3\s+75%\s+1/);
  });

  it('OK with no findings and missing facts renders — instead of crashing', async () => {
    const out = (await health(['diagnosis', '12'], ok({ productId: 12, overallSeverity: 'OK', findings: [], facts: { velocity: { trend: 'INSUFFICIENT_DATA' }, modules: [] } }))).stdout;
    expect(out).toContain('总体 正常 (OK)');
    expect(out).toContain('没有发现需要关注的问题');
    expect(out).toMatch(/速度趋势\s+数据不足（近期 —/);
    expect(out).toMatch(/计划结束\s+—/);
    expect((await health(['diagnosis', '12'], ok(null))).exitCode).toBeUndefined();
  });

  it('prints --json and maps 1002', async () => {
    expect(JSON.parse((await health(['diagnosis', '12', '--json'], ok(diagnosis))).stdout).overallSeverity).toBe('CRITICAL');
    expect((await health(['diagnosis', '12'], bizError(1002))).stderr).toContain('不存在');
  });
});

const explain = {
  productId: 12, releaseId: null, aiAvailable: true, aiGenerated: true, source: 'AI', cached: false, explanation: '进度落后主要因为速度下降。', question: null,
  model: 'claude-x', tokensUsed: 1834, aiWarning: null, overallSeverity: 'WARNING', findings: diagnosis.findings, facts: {},
};

describe('pm health explain <productId>', () => {
  it('POSTs the question with a long client timeout (>= 120 s)', async () => {
    const r = await health(['explain', '12', '--release', '5', '--question', '为什么延期？'], ok(explain));
    expect(r.http.post).toHaveBeenCalledWith('/progress/products/12/explain', { releaseId: 5, question: '为什么延期？' }, { timeout: 180000 });
    expect(180000).toBeGreaterThanOrEqual(120000);
  });

  it('sends {} without flags and drops a blank question', async () => {
    expect((await health(['explain', '12'], ok(explain))).http.post).toHaveBeenCalledWith('/progress/products/12/explain', {}, { timeout: 180000 });
    expect((await health(['explain', '12', '--question', '   '], ok(explain))).http.post).toHaveBeenCalledWith('/progress/products/12/explain', {}, { timeout: 180000 });
  });

  it('accepts a 500-char question and rejects 501 (no request)', async () => {
    expect((await health(['explain', '12', '--question', 'x'.repeat(500)], ok(explain))).exitCode).toBeUndefined();
    await expectRejected(['explain', '12', '--question', 'x'.repeat(501)], '--question');
    await expectRejected(['explain', '12', '--release', 'x'], '--release');
  });

  it('labels the AI text as AI-generated and shows model / tokens, then the deterministic findings', async () => {
    const out = (await health(['explain', '12'], ok(explain))).stdout;
    expect(out).toContain('AI 生成，仅供参考，需人工确认');
    expect(out).toContain('进度落后主要因为速度下降。');
    expect(out).toContain('模型 claude-x · tokens 1834');
    expect(out).not.toContain('缓存命中');
    expect(out).toMatch(/VELOCITY_DECLINE/);
    expect(out).toContain('确定性诊断（非 AI）');
  });

  it('shows the question and flags a cached answer', async () => {
    const out = (await health(['explain', '12', '--question', 'q'], ok({ ...explain, cached: true, question: '为什么延期？' }))).stdout;
    expect(out).toContain('问题: 为什么延期？');
    expect(out).toContain('缓存命中');
  });

  it('AI unavailable (still HTTP 200): says why, no AI section, findings remain', async () => {
    const out = (await health(['explain', '12'], ok({ ...explain, aiAvailable: false, aiGenerated: false, source: null, explanation: null, model: null, tokensUsed: null, aiWarning: 'token 余额不足' }))).stdout;
    expect(out).toContain('AI 解读不可用：token 余额不足');
    expect(out).not.toContain('AI 生成，仅供参考');
    expect(out).toMatch(/CRITICAL\s+VELOCITY_DECLINE/);
  });

  it('adds a "do not blindly retry" hint on a client timeout', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('timeout of 180000ms exceeded'));
    const r = await health(['explain', '12']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('timeout of 180000ms exceeded');
    expect(r.stderr).toContain('缓存');
  });

  it('prints --json and maps 2000', async () => {
    expect(JSON.parse((await health(['explain', '12', '--json'], ok(explain))).stdout).aiGenerated).toBe(true);
    expect((await health(['explain', '12'], bizError(2000))).stderr).toContain('组织的成员');
  });
});
