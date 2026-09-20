import { ApiDate, DASH, dash, fmtDate, fmtNum, renderTable } from '../../../utils/cliHelpers';

/**
 * Scope/progress KPIs shared by `pm health` (product) and `release health` (ScopeKpiVo on the
 * backend). Every number is nullable: null renders as "—", a real 0 stays 0.
 * All workload numbers are in `weightBasis` units — except the baseline-related ones when
 * `baselineBasisMismatch` is true (those are in `baselineWeightBasis`).
 */
export interface ScopeKpi {
  weightBasis?: string | null;
  basisFallbackTaskCount?: number | null;
  currentScopeWeight?: number | null;
  baselineScopeWeight?: number | null;
  baselineWeightBasis?: string | null;
  baselineBasisMismatch?: boolean | null;
  scopeChange?: number | null;
  scopeGrowthPct?: number | null;
  baselineSetAt?: ApiDate;
  weightedProgress?: number | null;
  earnedWeight?: number | null;
  baselineProgressPct?: number | null;
  completedScopeWeight?: number | null;
  remainingScopeWeight?: number | null;
  blockedWeight?: number | null;
  blockedWeightRatio?: number | null;
  aiCompletedWeight?: number | null;
  humanCompletedWeight?: number | null;
  aiContributionPct?: number | null;
  velocity4w?: number | null;
  velocity8w?: number | null;
  estimatedCompletionDate?: string | null;
  velocityDataStatus?: string | null;
}

const UNITS: Record<string, string> = { ESTIMATED_HOURS: 'h', STORY_POINT: 'SP', WEIGHT: '权重' };

export const INSUFFICIENT = 'INSUFFICIENT_DATA';

/** `ESTIMATED_HOURS (h)`; unknown/absent basis -> the raw value or "—". */
export function basisLabel(basis?: string | null): string {
  return basis && UNITS[basis] ? `${basis} (${UNITS[basis]})` : dash(basis);
}

/** Label/value block; `table` measures CJK width so the values line up. */
export const block = (rows: [string, string][]) => renderTable(rows);

const perWeek = (v?: number | null) => (v == null ? DASH : `${fmtNum(v)} /周`);

/** INSUFFICIENT_DATA is "数据不足", never a made-up date; a missing date is "—". */
export function etaLabel(k: ScopeKpi): string {
  if (k.velocityDataStatus === INSUFFICIENT) return '数据不足';
  return k.estimatedCompletionDate ? fmtDate(k.estimatedCompletionDate) : DASH;
}

/**
 * The sections after the entity-specific head. `rebaselineHint` is the command that re-sets the
 * baseline for this entity, shown when the baseline is in another unit than the current basis.
 */
export function renderScopeSections(k: ScopeKpi, rebaselineHint: string): string[] {
  const lines: string[] = [
    '工作量口径',
    block([
      ['口径', basisLabel(k.weightBasis)],
      ['回退任务数', dash(k.basisFallbackTaskCount)],
      ['已完成范围', fmtNum(k.completedScopeWeight)],
      ['剩余范围', fmtNum(k.remainingScopeWeight)],
      ['等价完成量', fmtNum(k.earnedWeight)],
    ]),
  ];
  if ((k.basisFallbackTaskCount ?? 0) > 0) {
    lines.push(`⚠ ${k.basisFallbackTaskCount} 个任务缺少 ${dash(k.weightBasis)} 的取值，已回退到下一级口径（单位混合，数字仅供参考）`);
  }
  lines.push(
    '',
    '范围与基线',
    block([
      ['当前范围', fmtNum(k.currentScopeWeight)],
      ['基线范围', fmtNum(k.baselineScopeWeight)],
      ['基线口径', basisLabel(k.baselineWeightBasis)],
      ['范围变化', fmtNum(k.scopeChange)],
      ['范围增长', fmtNum(k.scopeGrowthPct, '%', 1)],
      ['基线进度', fmtNum(k.baselineProgressPct, '%', 1)],
      ['基线时间', fmtDate(k.baselineSetAt)],
    ])
  );
  if (k.baselineBasisMismatch) {
    lines.push(
      `⚠ 基线口径 ${dash(k.baselineWeightBasis)} 与当前口径 ${dash(k.weightBasis)} 不同：基线范围 / 范围变化 / 范围增长 / 基线进度 的单位是 ${dash(k.baselineWeightBasis)}。` +
        `重设基线即可迁到当前口径（${rebaselineHint}）`
    );
  }
  lines.push(
    '',
    '加权进度与阻塞',
    block([
      ['加权进度', fmtNum(k.weightedProgress, '%')],
      ['阻塞权重', fmtNum(k.blockedWeight)],
      ['阻塞占比', fmtNum(k.blockedWeightRatio, '%', 1)],
    ]),
    '',
    'AI 贡献',
    block([
      ['AI 完成权重', fmtNum(k.aiCompletedWeight)],
      ['人工完成权重', fmtNum(k.humanCompletedWeight)],
      ['AI 占比', fmtNum(k.aiContributionPct, '%', 1)],
    ]),
    '',
    '速度与预测',
    block([
      ['近 4 周速度', perWeek(k.velocity4w)],
      ['近 8 周速度', perWeek(k.velocity8w)],
      ['预计完成', etaLabel(k)],
      ['速度数据', dash(k.velocityDataStatus)],
    ])
  );
  return lines;
}
