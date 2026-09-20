import { ApiDate } from '../../utils/cliHelpers';
export interface ReviewExpected {
    solutionId?: number | null;
    solutionName?: string | null;
    effortDays?: number | null;
    cycleWeeks?: number | null;
    cost?: number | null;
    rawEffortDays?: number | null;
    rawCycleWeeks?: number | null;
    rawCost?: number | null;
    kpis?: Array<{
        name?: string | null;
        current?: string | null;
        target?: string | null;
        unit?: string | null;
    }> | null;
}
export interface EffectReview {
    id?: number;
    ideaId?: number;
    releaseId?: number | null;
    status?: string | null;
    expected?: ReviewExpected | null;
    actualEffortDays?: number | null;
    actualCycleWeeks?: number | null;
    actualCost?: number | null;
    notes?: string | null;
    reviewedBy?: number | null;
    reviewedAt?: ApiDate;
}
export interface EffectMetric {
    name?: string | null;
    expected?: number | null;
    actual?: number | null;
    unit?: string | null;
    accuracyPct?: number | null;
}
export interface EffectReviewResult {
    review: EffectReview;
    metrics?: EffectMetric[] | null;
    accuracy?: {
        effortAccuracyPct?: number | null;
        scheduleAccuracyPct?: number | null;
        costAccuracyPct?: number | null;
        effectAccuracyPct?: number | null;
    } | null;
}
export declare function renderReview(result: EffectReviewResult): string;
//# sourceMappingURL=reviewRender.d.ts.map