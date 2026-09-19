import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerHealthCommands } from '../index';
import { ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerHealthCommands(program.command('pm'));
const health = (args: string[], response = ok(null)) => runCli(register, ['pm', 'health', ...args], response);

afterEach(() => vi.restoreAllMocks());

/** Value printed next to a label at the start of a line (so "口径" does not match "工作量口径"). */
const valueOf = (out: string, label: string) => new RegExp(`(?:^|\\n)${label}[ \\t]+(\\S+)`).exec(out)?.[1];

// A pre-C1 style response: none of the new fields at all.
const legacy = { productId: 10, productName: 'good7ob', overallProgress: 40, currentScopeWeight: 120, totalTasks: 10, completedTasks: 4 };

const c1 = {
  ...legacy, weightBasis: 'ESTIMATED_HOURS', basisFallbackTaskCount: 0, earnedWeight: 46.15, completedScopeWeight: 600,
  remainingScopeWeight: 700, baselineScopeWeight: 1000, baselineWeightBasis: 'ESTIMATED_HOURS', baselineBasisMismatch: false,
  scopeChange: 300, scopeGrowthPct: 30, baselineProgressPct: 60, weightedProgress: 46.15, velocity4w: 50, velocity8w: 48.5,
  estimatedCompletionDate: '2026-11-28', velocityDataStatus: 'OK',
};

describe('pm health <productId> — C1 fields', () => {
  it('renders every new field when present', async () => {
    const r = await health(['10'], ok(c1));
    expect(r.stdout).toContain('ESTIMATED_HOURS (h)');
    expect(valueOf(r.stdout, '已完成范围')).toBe('600');
    expect(valueOf(r.stdout, '剩余范围')).toBe('700');
    expect(valueOf(r.stdout, '等价完成量')).toBe('46.15');
    expect(valueOf(r.stdout, '基线进度')).toBe('60%');
    expect(valueOf(r.stdout, '近 4 周速度')).toBe('50');
    expect(r.stdout).toMatch(/近 8 周速度\s+48\.5 \/周/);
    expect(valueOf(r.stdout, '预计完成')).toBe('2026-11-28');
    expect(valueOf(r.stdout, '速度数据')).toBe('OK');
    expect(r.stdout).not.toContain('⚠');
  });

  it('renders a pre-C1 response (all new fields absent) as — without crashing', async () => {
    const r = await health(['10'], ok(legacy));
    expect(r.exitCode).toBeUndefined();
    for (const label of ['口径', '回退任务数', '已完成范围', '剩余范围', '等价完成量', '基线口径', '基线进度', '预计完成', '速度数据']) {
      expect(valueOf(r.stdout, label)).toBe('—');
    }
    expect(r.stdout).toMatch(/近 4 周速度\s+—/);
    expect(r.stdout).not.toContain('⚠');
  });

  it('shows 数据不足 (not a date) for INSUFFICIENT_DATA, and — when OK but no date', async () => {
    const insufficient = await health(['10'], ok({ ...c1, velocity4w: null, velocity8w: null, estimatedCompletionDate: null, velocityDataStatus: 'INSUFFICIENT_DATA' }));
    expect(valueOf(insufficient.stdout, '预计完成')).toBe('数据不足');
    expect(insufficient.stdout).toMatch(/近 4 周速度\s+—/);
    // defensive: even if a date slipped through, INSUFFICIENT_DATA wins
    const stray = await health(['10'], ok({ ...c1, estimatedCompletionDate: '2026-11-28', velocityDataStatus: 'INSUFFICIENT_DATA' }));
    expect(valueOf(stray.stdout, '预计完成')).toBe('数据不足');
    const noDate = await health(['10'], ok({ ...c1, estimatedCompletionDate: null }));
    expect(valueOf(noDate.stdout, '预计完成')).toBe('—');
  });

  it('keeps a real 0 velocity as 0 /周', async () => {
    const r = await health(['10'], ok({ ...c1, velocity4w: 0 }));
    expect(r.stdout).toMatch(/近 4 周速度\s+0 \/周/);
  });

  it('warns when tasks fell back to another basis', async () => {
    const r = await health(['10'], ok({ ...c1, basisFallbackTaskCount: 7 }));
    expect(r.stdout).toContain('⚠ 7 个任务缺少 ESTIMATED_HOURS');
    expect(valueOf(r.stdout, '回退任务数')).toBe('7');
  });

  it('warns on baseline basis mismatch and names the baseline unit + the fix', async () => {
    const r = await health(['10'], ok({ ...c1, weightBasis: 'STORY_POINT', baselineWeightBasis: 'WEIGHT', baselineBasisMismatch: true }));
    expect(r.stdout).toContain('STORY_POINT (SP)');
    expect(valueOf(r.stdout, '基线口径')).toBe('WEIGHT');
    expect(r.stdout).toContain('基线口径 WEIGHT 与当前口径 STORY_POINT 不同');
    expect(r.stdout).toContain('pm health baseline 10');
  });

  it('--json passes the new fields through untouched', async () => {
    const json = JSON.parse((await health(['10', '--json'], ok(c1))).stdout);
    expect(json.velocityDataStatus).toBe('OK');
    expect(json.estimatedCompletionDate).toBe('2026-11-28');
  });
});

describe('pm health modules — weightBasis', () => {
  const row = { projectId: 1, moduleName: '订单', actualProgress: 10, weightedProgress: 12.5, weightBasis: 'STORY_POINT' };

  it('names the basis in the footer when the rows carry one', async () => {
    expect((await health(['modules', '10'], ok([row]))).stdout).toContain('加权进度口径 STORY_POINT (SP)');
  });

  it('omits it for old responses', async () => {
    expect((await health(['modules', '10'], ok([{ ...row, weightBasis: undefined }]))).stdout).not.toContain('口径');
  });
});
