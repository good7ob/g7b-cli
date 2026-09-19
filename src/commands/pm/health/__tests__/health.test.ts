import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerHealthCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerHealthCommands(program.command('pm'));
const health = (args: string[], response = ok(null)) => runCli(register, ['pm', 'health', ...args], response);

afterEach(() => vi.restoreAllMocks());

const kpi = {
  productId: 10, productName: 'good7ob', overallProgress: 42.5, plannedProgress: null, scheduleVariance: null,
  remainingWork: 60, totalTasks: 100, completedTasks: 40, riskLevel: 'MEDIUM', moduleCount: 3, asOf: '2026-09-19T08:00:00Z',
  currentScopeWeight: 120, baselineScopeWeight: null, scopeChange: null, scopeGrowthPct: null, baselineSetAt: null,
  weightedProgress: 0, blockedWeight: 0, blockedWeightRatio: null,
  aiCompletedWeight: 12, humanCompletedWeight: 4, aiContributionPct: null,
};

/** Value printed next to a label in the block layout. */
const valueOf = (out: string, label: string) => new RegExp(`${label}\\s+(\\S+)`).exec(out)?.[1];

describe('pm health <productId>', () => {
  it('GETs /progress/products/{id}/health', async () => {
    const r = await health(['10'], ok(kpi));
    expect(r.http.get).toHaveBeenCalledWith('/progress/products/10/health', { params: undefined });
    expect(r.exitCode).toBeUndefined();
  });

  it('renders null as — and a real 0 as 0 (never the other way round)', async () => {
    const r = await health(['10'], ok(kpi));
    expect(valueOf(r.stdout, '整体进度')).toBe('42.5%');
    for (const label of ['计划进度', '进度偏差', '基线范围', '范围变化', '范围增长', '基线时间', '阻塞占比', 'AI 占比']) {
      expect(valueOf(r.stdout, label)).toBe('—');
    }
    expect(valueOf(r.stdout, '加权进度')).toBe('0%');
    expect(valueOf(r.stdout, '阻塞权重')).toBe('0');
    expect(valueOf(r.stdout, '当前范围')).toBe('120');
  });

  it('renders the new MVP-3 fields when present', async () => {
    const full = { ...kpi, baselineScopeWeight: 100, scopeChange: 20, scopeGrowthPct: 20, baselineSetAt: '2026-09-01T00:00:00Z',
      weightedProgress: 38.256, blockedWeightRatio: 5.5, aiContributionPct: 75 };
    const r = await health(['10'], ok(full));
    expect(valueOf(r.stdout, '基线范围')).toBe('100');
    expect(valueOf(r.stdout, '范围增长')).toBe('20%');
    expect(valueOf(r.stdout, '加权进度')).toBe('38.26%');
    expect(valueOf(r.stdout, 'AI 占比')).toBe('75%');
  });

  it('--json keeps nulls untouched', async () => {
    const r = await health(['10', '--json'], ok(kpi));
    expect(JSON.parse(r.stdout).baselineScopeWeight).toBeNull();
  });

  it('rejects a non-numeric productId before calling the API', async () => {
    const r = await health(['abc']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('productId');
    expect(noHttpCalls(r)).toBe(true);
  });

  it.each([
    [40480, '产品不存在'],
    [40380, '不是该产品所属组织的成员'],
    [999, '未登录'],
  ])('maps business error %i', async (code, text) => {
    const r = await health(['10'], bizError(code, 'server says no'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain('server says no');
  });
});

describe('pm health modules <productId>', () => {
  const modules = [
    { projectId: 1, moduleName: '订单', ownerName: '张三', actualProgress: 10, plannedProgress: null, progressVariance: null,
      delayDays: 12, expectedEndDate: null, riskLevel: 'HIGH', totalTasks: 5, completedTasks: 1, blockedTasks: 0, weightedProgress: null },
    { projectId: 2, moduleName: '支付', ownerName: null, ownerId: 7, actualProgress: 0, plannedProgress: 20, progressVariance: -20,
      delayDays: 0, expectedEndDate: '2026-10-01', riskLevel: 'LOW', totalTasks: 2, completedTasks: 0, blockedTasks: 1, weightedProgress: 12.5 },
  ];

  it('GETs the modules endpoint and keeps the server order', async () => {
    const r = await health(['modules', '10'], ok(modules));
    expect(r.http.get).toHaveBeenCalledWith('/progress/products/10/health/modules', { params: undefined });
    expect(r.stdout.indexOf('订单')).toBeLessThan(r.stdout.indexOf('支付'));
  });

  it('renders null -> — and 0 -> 0 per column', async () => {
    const r = await health(['modules', '10'], ok(modules));
    expect(r.stdout).toMatch(/订单\s+张三\s+10%\s+—\s+—\s+12\s+—\s+—\s+HIGH\s+1\/5\s+0/);
    expect(r.stdout).toMatch(/支付\s+7\s+0%\s+20%\s+-20%\s+0\s+12.5%\s+2026-10-01\s+LOW\s+0\/2\s+1/);
  });

  it('handles an empty list and --json, and maps 40480', async () => {
    expect((await health(['modules', '10'], ok([]))).stdout).toContain('没有模块');
    expect(JSON.parse((await health(['modules', '10', '--json'], ok(modules))).stdout)).toHaveLength(2);
    expect((await health(['modules', '10'], bizError(40480))).stderr).toContain('产品不存在');
  });
});

describe('pm health baseline <productId>', () => {
  const baseline = { baselineId: 3, productId: 10, baselineScopeWeight: 120, baselineTaskCount: 80, note: null, setBy: 5, setAt: '2026-09-19T08:00:00Z' };

  it('POSTs an empty body without --note', async () => {
    const r = await health(['baseline', '10'], ok(baseline));
    expect(r.http.post).toHaveBeenCalledWith('/progress/products/10/health/baseline', {});
    expect(r.stdout).toContain('新基线 #3');
    expect(valueOf(r.stdout, '备注')).toBe('—');
  });

  it('POSTs the note', async () => {
    const r = await health(['baseline', '10', '--note', 'Q4 范围冻结'], ok({ ...baseline, note: 'Q4 范围冻结' }));
    expect(r.http.post).toHaveBeenCalledWith('/progress/products/10/health/baseline', { note: 'Q4 范围冻结' });
    expect(r.stdout).toContain('Q4 范围冻结');
  });

  it('caps the note at 500 chars locally, accepting exactly 500', async () => {
    const long = await health(['baseline', '10', '--note', 'x'.repeat(501)]);
    expect(long.stderr).toContain('--note');
    expect(noHttpCalls(long)).toBe(true);
    const edge = await health(['baseline', '10', '--note', 'x'.repeat(500)], ok(baseline));
    expect(edge.http.post).toHaveBeenCalledTimes(1);
  });

  it('maps 40080 and 40380', async () => {
    expect((await health(['baseline', '10', '--note', 'n'], bizError(40080, 'too long'))).stderr).toContain('备注过长');
    expect((await health(['baseline', '10'], bizError(40380, 'no'))).stderr).toContain('无权访问');
  });
});

describe('--json placement', () => {
  it('works before or after the subcommand', async () => {
    const after = await health(['baseline', '10', '--json'], ok({ baselineId: 3 }));
    expect(JSON.parse(after.stdout).baselineId).toBe(3);
    const before = await health(['--json', 'modules', '10'], ok([]));
    expect(JSON.parse(before.stdout)).toEqual([]);
  });
});
