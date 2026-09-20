import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIdeaCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const idea = (args: string[], response = ok({ id: 12, title: 'T' })) => runCli(registerIdeaCommands, ['idea', ...args], response);

beforeEach(() => {
  delete process.env.GOOD7OB_PRODUCT_ID;
});
afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await idea(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('idea status (A1: nine statuses)', () => {
  it.each(['evaluating', 'archived', 'planning', 'developing', 'released', 'validated'])('accepts %s', async (to) => {
    const r = await idea(['status', '5', to]);
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/status', { toStatus: to });
    expect(r.stdout).toContain(`→ ${to}`);
  });

  it.each(['approved', 'rejected'])('points %s at select / reject instead', async (to) => {
    await expectRejected(['status', '5', to], to === 'approved' ? 'idea select' : 'idea reject');
  });

  it('rejects unknown, and maps 1007 (illegal transition) and 1009 (lost race)', async () => {
    await expectRejected(['status', '5', 'done'], 'toStatus');
    const illegal = await idea(['status', '5', 'released'], bizError(1007, 'draft -> released'));
    expect(illegal.stderr).toContain('当前状态不允许');
    const race = await idea(['status', '5', 'planning'], bizError(1009, 'retry'));
    expect(race.stderr).toContain('请重试');
  });

  it('list --status accepts the new statuses', async () => {
    const r = await idea(['list', '--product', '3', '--status', 'validated'], ok({ records: [], total: 0 }));
    expect(r.http.get).toHaveBeenCalledWith('/forge/ideas', { params: { productId: 3, pageNum: 1, pageSize: 20, status: 'validated' } });
  });
});

describe('idea list --tag / --release, idea update --release', () => {
  const empty = ok({ records: [], total: 0 });

  it('list sends tag and releaseId only when given', async () => {
    const r = await idea(['list', '--product', '3', '--tag', 'Backend', '--release', '7'], empty);
    expect(r.http.get).toHaveBeenCalledWith('/forge/ideas', {
      params: { productId: 3, pageNum: 1, pageSize: 20, tag: 'Backend', releaseId: 7 },
    });
  });

  it.each([
    [['--release', 'abc'], '--release'],
    [['--tag', ' '], '--tag'],
    [['--tag', 'x'.repeat(31)], '--tag'],
  ])('list rejects %j', async (extra, needle) => {
    await expectRejected(['list', '--product', '3', ...extra], needle);
  });

  it('update --release / --clear-release map to releaseId / clearRelease', async () => {
    const link = await idea(['update', '5', '--release', '7']);
    expect(link.http.put).toHaveBeenCalledWith('/forge/ideas/5', { releaseId: 7 });
    const unlink = await idea(['update', '5', '--clear-release']);
    expect(unlink.http.put).toHaveBeenCalledWith('/forge/ideas/5', { clearRelease: true });
  });

  it('update rejects --release together with --clear-release, and a bad release id', async () => {
    await expectRejected(['update', '5', '--release', '7', '--clear-release'], '不能同时使用');
    await expectRejected(['update', '5', '--release', '0'], '--release');
  });

  it('update maps 1001 (release of another product / wrong state) with the server message', async () => {
    const r = await idea(['update', '5', '--release', '7'], bizError(1001, '发布不属于同一产品'));
    expect(r.stderr).toContain('参数值不合法');
    expect(r.stderr).toContain('发布不属于同一产品');
  });
});

describe('idea solution add / update with the structured estimate', () => {
  it('maps every estimate flag to its body field (numbers as numbers, kpi repeatable)', async () => {
    const r = await idea(['solution', 'add', '5', '--name', 'A',
      '--effort-frontend', '3.5', '--effort-backend', '5', '--effort-ai', '0', '--effort-test', '2', '--effort-pm', '1',
      '--cost', '30000', '--cloud-cost', '120.5', '--token-cost', '0', '--maintenance-cost', '500', '--cycle-weeks', '3',
      '--technical-risk', 'medium', '--product-risk', 'low', '--confidence', 'high', '--estimation-source', 'ai',
      '--expected-effect', '对账耗时下降 60%',
      '--kpi', '对账耗时:5h:2h:小时', '--kpi', 'NPS']);
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/solutions', {
      name: 'A',
      effortDaysFrontend: 3.5, effortDaysBackend: 5, effortDaysAi: 0, effortDaysTest: 2, effortDaysPm: 1,
      estimatedCost: 30000, cloudCostMonthly: 120.5, aiTokenCostMonthly: 0, maintenanceCost: 500, cycleWeeks: 3,
      technicalRisk: 'medium', productRisk: 'low', confidence: 'high', estimationSource: 'ai',
      expectedEffect: '对账耗时下降 60%',
      kpi: [{ name: '对账耗时', current: '5h', target: '2h', unit: '小时' }, { name: 'NPS' }],
    });
  });

  it('update sends only the given estimate fields; --kpi replaces, --clear-kpi empties', async () => {
    const one = await idea(['solution', 'update', '5', '8', '--effort-backend', '4.0', '--confidence', 'low']);
    expect(one.http.put).toHaveBeenCalledWith('/forge/ideas/5/solutions/8', { effortDaysBackend: 4, confidence: 'low' });
    const clear = await idea(['solution', 'update', '5', '8', '--clear-kpi']);
    expect(clear.http.put).toHaveBeenCalledWith('/forge/ideas/5/solutions/8', { kpi: [] });
    await expectRejected(['solution', 'update', '5', '8', '--kpi', 'a', '--clear-kpi'], '--clear-kpi');
  });

  it.each([
    ['negative days', ['--effort-backend', '-1'], '--effort-backend'],
    ['too many decimals for days', ['--effort-frontend', '1.25'], '最多 1 位小数'],
    ['too many decimals for money', ['--cost', '1.234'], '最多 2 位小数'],
    ['days over max', ['--effort-ai', '100000'], '--effort-ai'],
    ['cycle over max', ['--cycle-weeks', '1000'], '--cycle-weeks'],
    ['non numeric cost', ['--cloud-cost', 'abc'], '--cloud-cost'],
    ['unknown risk', ['--technical-risk', 'critical'], '--technical-risk'],
    ['unknown confidence', ['--confidence', 'sure'], '--confidence'],
    ['unknown source', ['--estimation-source', 'guess'], '--estimation-source'],
    ['expected-effect over 2000', ['--expected-effect', 'x'.repeat(2001)], '--expected-effect'],
    ['kpi without name', ['--kpi', ':5h:2h'], '--kpi'],
    ['kpi with too many parts', ['--kpi', 'a:b:c:d:e'], '--kpi'],
    ['kpi unit over 20', ['--kpi', `a:1:2:${'u'.repeat(21)}`], 'unit'],
    ['kpi name over 100', ['--kpi', 'n'.repeat(101)], 'name'],
    ['more than 20 kpis', Array.from({ length: 21 }, (_, i) => ['--kpi', `k${i}`]).flat(), '最多 20'],
  ])('add rejects %s before calling the API', async (_n, extra, needle) => {
    await expectRejected(['solution', 'add', '5', '--name', 'A', ...extra], needle);
  });

  it('accepts trailing zeros beyond the scale (3.50 days is 3.5)', async () => {
    const r = await idea(['solution', 'add', '5', '--name', 'A', '--effort-test', '3.50']);
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/solutions', { name: 'A', effortDaysTest: 3.5 });
  });

  it('maps 1007 (solutions only editable in draft/evaluating)', async () => {
    const r = await idea(['solution', 'add', '5', '--name', 'A', '--cost', '1'], bizError(1007, 'locked'));
    expect(r.stderr).toContain('当前状态不允许');
  });
});

describe('idea get (A1 rendering)', () => {
  const A = {
    id: 2, name: '方案A', costNote: '2 人天', isSelected: false,
    effortDaysFrontend: 3.5, effortDaysBackend: 5, effortDaysAi: null, effortDaysTest: 2, effortDaysPm: 1, totalEffortDays: 11.5,
    estimatedCost: 30000, cloudCostMonthly: 120, aiTokenCostMonthly: 0, maintenanceCost: 500, cycleWeeks: 3,
    technicalRisk: 'medium', productRisk: 'low', confidence: 'medium', estimationSource: 'ai',
    expectedEffect: '对账耗时下降 60%', kpi: [{ name: '对账耗时', current: '5h', target: '2h', unit: '小时' }],
    rejectionReason: null,
  };
  const B = { id: 3, name: '方案B', isSelected: false, estimationSource: 'manual', rejectionReason: '周期过长' };
  const detail = ok({
    idea: { id: 1, productId: 3, title: '导出', status: 'evaluating', releaseId: 7 },
    solutions: [A, B],
    decision: { id: 4, selectedSolutionId: 2, decidedBy: 11, decidedAt: '2026-09-19 10:40:00', reason: '成本最低', approvalStatus: 'pending', approvalId: 31 },
    tags: ['backend', 'ai'],
  });

  it('shows release and tags, and the solutions side by side with total effort, cost, cycle, risks, confidence and AI badge', async () => {
    const r = await idea(['get', '1'], detail);
    expect(r.stdout).toContain('发布: #7');
    expect(r.stdout).toContain('标签: backend, ai');
    expect(r.stdout).toMatch(/#2 方案A\s+#3 方案B/);
    expect(r.stdout).toMatch(/总人日\s+11\.5\s+—/);
    expect(r.stdout).toMatch(/预计成本\s+30000\s+—/);
    expect(r.stdout).toMatch(/人日明细\s+前端 3\.5\s+前端 —\n\s+后端 5\s+后端 —\n\s+AI —\s+AI —\n\s+测试 2\s+测试 —\n\s+PM 1\s+PM —/);
    expect(r.stdout).toMatch(/月度成本\s+云 120\s+云 —\n\s+Token 0\s+Token —\n\s+维护 500\s+维护 —/);
    expect(r.stdout).toMatch(/周期\s+3 周\s+—/);
    expect(r.stdout).toMatch(/技术风险\s+medium\s+—/);
    expect(r.stdout).toMatch(/产品风险\s+low\s+—/);
    expect(r.stdout).toMatch(/可信度\s+medium \[AI 估算\]\s+—/);
    expect(r.stdout).toContain('对账耗时: 5h → 2h 小时');
    expect(r.stdout).toMatch(/落选原因\s+—\s+周期过长/);
  });

  it('never renders a missing number as 0', async () => {
    const r = await idea(['get', '1'], ok({ idea: { id: 1 }, solutions: [{ id: 2, name: 'A', confidence: 'low' }] }));
    expect(r.stdout).toMatch(/总人日\s+—/);
    expect(r.stdout).toMatch(/预计成本\s+—/);
    expect(r.stdout).toMatch(/云 —\n\s+Token —\n\s+维护 —/);
    expect(r.stdout).toContain('发布: —');
    expect(r.stdout).toContain('标签: —');
  });

  it('shows the pending approval decision', async () => {
    const r = await idea(['get', '1'], detail);
    expect(r.stdout).toContain('决策: 选定 #2 方案A — 成本最低');
    expect(r.stdout).toContain('审批: pending (审批单 #31)');
  });

  it('shows a not_required (MVP-derived) decision without an approval id', async () => {
    const r = await idea(['get', '1'], ok({
      idea: { id: 1, status: 'approved' }, solutions: [{ id: 2, name: 'A', isSelected: true }],
      decision: { id: null, selectedSolutionId: 2, reason: 'r', approvalStatus: 'not_required', approvalId: null },
    }));
    expect(r.stdout).toContain('审批: not_required');
    expect(r.stdout).not.toContain('审批单');
  });

  it('omits the estimate table for solutions without any estimate (MVP rows)', async () => {
    const r = await idea(['get', '1'], ok({ idea: { id: 1 }, solutions: [{ id: 2, name: 'A', costNote: 'c' }], tags: [] }));
    expect(r.stdout).not.toContain('估算对比');
  });

  it('--json prints the raw detail', async () => {
    const r = await idea(['get', '1', '--json'], detail);
    expect(JSON.parse(r.stdout).decision.approvalId).toBe(31);
  });
});

describe('idea select (A1)', () => {
  it('sends rejectedReasons and requireApproval', async () => {
    const r = await idea(['select', '5', '8', '--reason', '成本最低',
      '--rejected-reason', '9:周期过长', '--rejected-reason', '10:含:冒号的原因', '--require-approval'],
    ok({ idea: { id: 5, status: 'evaluating' }, solutions: [], decision: { approvalStatus: 'pending', approvalId: 31 } }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/solutions/8/select', {
      decisionReason: '成本最低',
      rejectedReasons: [{ solutionId: 9, reason: '周期过长' }, { solutionId: 10, reason: '含:冒号的原因' }],
      requireApproval: true,
    });
    expect(r.stdout).toContain('已提交审批');
    expect(r.stdout).toContain('仍为 evaluating');
    expect(r.stdout).toContain('审批单 #31');
    expect(r.stdout).not.toContain('已批准');
  });

  it('with rejected reasons only, still announces the approved idea and requirement', async () => {
    const r = await idea(['select', '5', '8', '--reason', 'r', '--rejected-reason', '9:x'],
      ok({ idea: { id: 5, status: 'approved', requirementId: 77 }, solutions: [], decision: { approvalStatus: 'not_required' } }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/solutions/8/select', {
      decisionReason: 'r', rejectedReasons: [{ solutionId: 9, reason: 'x' }],
    });
    expect(r.stdout).toContain('需求 #77');
  });

  it.each([
    ['no colon', ['--rejected-reason', '9'], '<solutionId>:<原因>'],
    ['non-numeric solution id', ['--rejected-reason', 'x:why'], 'solutionId'],
    ['blank reason', ['--rejected-reason', '9: '], '原因'],
    ['reason over 1000', ['--rejected-reason', `9:${'x'.repeat(1001)}`], '最多 1000'],
    ['the selected solution itself', ['--rejected-reason', '8:why'], '选定的方案本身'],
    ['duplicate solution', ['--rejected-reason', '9:a', '--rejected-reason', '9:b'], '不能重复'],
  ])('rejects %s before calling the API', async (_n, extra, needle) => {
    await expectRejected(['select', '5', '8', '--reason', 'r', ...extra], needle);
  });

  it('maps 1006 (a decision is already pending) and 1009 (lost the race)', async () => {
    const pending = await idea(['select', '5', '8', '--reason', 'r', '--require-approval'], bizError(1006, 'pending'));
    expect(pending.exitCode).toBe(1);
    expect(pending.stderr).toContain('待审批的决策');
    const race = await idea(['select', '5', '8', '--reason', 'r'], bizError(1009, 'retry'));
    expect(race.stderr).toContain('请重试');
  });

  it('--json prints the returned detail', async () => {
    const r = await idea(['select', '5', '8', '--reason', 'r', '--json'], ok({ idea: { id: 5 }, decision: { approvalId: 31 } }));
    expect(JSON.parse(r.stdout).decision.approvalId).toBe(31);
  });
});
