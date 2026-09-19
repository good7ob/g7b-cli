import { ApiDate } from '../../../utils/cliHelpers';
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
export declare const INSUFFICIENT = "INSUFFICIENT_DATA";
/** `ESTIMATED_HOURS (h)`; unknown/absent basis -> the raw value or "—". */
export declare function basisLabel(basis?: string | null): string;
/** Label/value block; `table` measures CJK width so the values line up. */
export declare const block: (rows: [string, string][]) => string;
/** INSUFFICIENT_DATA is "数据不足", never a made-up date; a missing date is "—". */
export declare function etaLabel(k: ScopeKpi): string;
/**
 * The sections after the entity-specific head. `rebaselineHint` is the command that re-sets the
 * baseline for this entity, shown when the baseline is in another unit than the current basis.
 */
export declare function renderScopeSections(k: ScopeKpi, rebaselineHint: string): string[];
//# sourceMappingURL=kpi.d.ts.map