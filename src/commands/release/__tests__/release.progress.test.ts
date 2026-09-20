import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerReleaseCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const release = (args: string[], response = ok(null)) => runCli(registerReleaseCommands, ['release', ...args], response);

afterEach(() => vi.restoreAllMocks());

const valueOf = (out: string, label: string) => new RegExp(`(?:^|\\n)${label}[ \\t]+(\\S+)`).exec(out)?.[1];

const kpi = {
  releaseId: 5, productId: 12, releaseName: 'v1.2 发布', version: '1.2.0', status: 'in_progress', totalTasks: 42, completedTasks: 17,
  asOf: '2026-09-19T10:00:00Z', weightBasis: 'ESTIMATED_HOURS', basisFallbackTaskCount: 0, currentScopeWeight: 1300, baselineScopeWeight: 1000,
  baselineWeightBasis: 'ESTIMATED_HOURS', baselineBasisMismatch: false, scopeChange: 300, scopeGrowthPct: 30, baselineProgressPct: 60,
  weightedProgress: 46.15, earnedWeight: 600, completedScopeWeight: 600, remainingScopeWeight: 700, blockedWeight: 0, blockedWeightRatio: 0,
  aiCompletedWeight: 100, humanCompletedWeight: 500, aiContributionPct: 16.7, velocity4w: 50, velocity8w: null,
  estimatedCompletionDate: '2026-11-28', velocityDataStatus: 'OK',
};

describe('release health <releaseId>', () => {
  it('GETs /progress/releases/{id}/health and renders head + KPI sections', async () => {
    const r = await release(['health', '5'], ok(kpi));
    expect(r.http.get).toHaveBeenCalledWith('/progress/releases/5/health', { params: undefined });
    expect(r.stdout).toContain('Release 健康  #5  1.2.0  v1.2 发布');
    expect(valueOf(r.stdout, '任务完成')).toBe('17');
    expect(r.stdout).toMatch(/任务完成\s+17 \/ 42/);
    expect(valueOf(r.stdout, '范围变化')).toBe('300');
    expect(valueOf(r.stdout, '基线进度')).toBe('60%');
    expect(valueOf(r.stdout, '加权进度')).toBe('46.15%');
    expect(valueOf(r.stdout, '预计完成')).toBe('2026-11-28');
    expect(r.stdout).toMatch(/近 8 周速度\s+—/);
    expect(r.exitCode).toBeUndefined();
  });

  it('INSUFFICIENT_DATA -> 数据不足; null baseline -> —', async () => {
    const r = await release(['health', '5'], ok({ ...kpi, baselineScopeWeight: null, baselineProgressPct: null, velocity4w: null,
      estimatedCompletionDate: null, velocityDataStatus: 'INSUFFICIENT_DATA' }));
    expect(valueOf(r.stdout, '预计完成')).toBe('数据不足');
    expect(valueOf(r.stdout, '基线范围')).toBe('—');
    expect(valueOf(r.stdout, '基线进度')).toBe('—');
  });

  it('warns on fallback and basis mismatch, pointing at `release baseline`', async () => {
    const r = await release(['health', '5'], ok({ ...kpi, basisFallbackTaskCount: 3, weightBasis: 'STORY_POINT', baselineWeightBasis: 'WEIGHT', baselineBasisMismatch: true }));
    expect(r.stdout).toContain('⚠ 3 个任务缺少 STORY_POINT');
    expect(r.stdout).toContain('基线口径 WEIGHT 与当前口径 STORY_POINT 不同');
    expect(r.stdout).toContain('release baseline 5');
  });

  it('renders an empty body as — and --json passes the payload through', async () => {
    expect((await release(['health', '5'], ok(null))).exitCode).toBeUndefined();
    expect(JSON.parse((await release(['health', '5', '--json'], ok(kpi))).stdout).releaseName).toBe('v1.2 发布');
  });

  it('rejects a bad id locally', async () => {
    const r = await release(['health', 'abc']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('releaseId');
    expect(noHttpCalls(r)).toBe(true);
  });

  it.each([
    [1002, 'Release'],
    [1008, '缺少 Release id'],
    [2000, '组织的成员'],
    [999, '未登录'],
  ])('maps business error %i (progress codes, not the /forge/releases ones)', async (code, text) => {
    const r = await release(['health', '5'], bizError(code, 'server says no'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain('server says no');
  });
});

describe('release baseline <releaseId>', () => {
  const baseline = { baselineId: 8, releaseId: 5, baselineScope: 1000, baselineTaskCount: 42, weightBasis: 'ESTIMATED_HOURS', note: null, setBy: 11, setAt: '2026-09-19T10:00:00Z' };

  it('POSTs an empty body without --note', async () => {
    const r = await release(['baseline', '5'], ok(baseline));
    expect(r.http.post).toHaveBeenCalledWith('/progress/releases/5/baseline', {});
    expect(r.stdout).toContain('Release #5 当前范围设为新基线 #8');
    expect(valueOf(r.stdout, '基线范围')).toBe('1000');
    expect(valueOf(r.stdout, '备注')).toBe('—');
    expect(r.stdout).toContain('11 @ 2026-09-19 10:00:00Z');
  });

  it('POSTs the trimmed note; a blank note is no note', async () => {
    const r = await release(['baseline', '5', '--note', '  冻结范围 '], ok({ ...baseline, note: '冻结范围' }));
    expect(r.http.post).toHaveBeenCalledWith('/progress/releases/5/baseline', { note: '冻结范围' });
    expect(r.stdout).toContain('冻结范围');
    expect((await release(['baseline', '5', '--note', '   '], ok(baseline))).http.post).toHaveBeenCalledWith('/progress/releases/5/baseline', {});
  });

  it('caps the note at 500 chars locally, accepting exactly 500', async () => {
    const long = await release(['baseline', '5', '--note', 'x'.repeat(501)]);
    expect(long.exitCode).toBe(1);
    expect(long.stderr).toContain('--note');
    expect(noHttpCalls(long)).toBe(true);
    expect((await release(['baseline', '5', '--note', 'x'.repeat(500)], ok(baseline))).http.post).toHaveBeenCalledTimes(1);
  });

  it('--json and business errors (1001 / 1002 / 1008 / 2000)', async () => {
    expect(JSON.parse((await release(['baseline', '5', '--json'], ok(baseline))).stdout).baselineId).toBe(8);
    expect((await release(['baseline', '5'], bizError(1001, 'note 过长'))).stderr).toContain('note 过长');
    expect((await release(['baseline', '5'], bizError(1002))).stderr).toContain('不存在');
    expect((await release(['baseline', '5'], bizError(1008))).stderr).toContain('缺少 Release id');
    expect((await release(['baseline', '5'], bizError(2000))).stderr).toContain('组织的成员');
  });

  it('rejects a bad id locally', async () => {
    const r = await release(['baseline', '0']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });
});
