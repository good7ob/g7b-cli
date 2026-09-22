import { ApiDate } from '../../../utils/cliHelpers';
/** Renderers for `pm health cost`, `budget` and `cost-entry` (api-0090 §9, §10). Money is shown with 2 decimals. */
export interface Budget {
    configured?: boolean | null;
    id?: number | null;
    productId?: number | null;
    releaseId?: number | null;
    amount?: number | null;
    currency?: string | null;
    laborRatePerHour?: number | null;
    tokenPricePerMillion?: number | null;
    note?: string | null;
    updatedBy?: number | null;
    updatedAt?: ApiDate;
}
export interface CostEntry {
    id: number;
    productId?: number | null;
    releaseId?: number | null;
    category?: string | null;
    amount?: number | null;
    currency?: string | null;
    incurredOn?: string | null;
    note?: string | null;
    source?: string | null;
    createdBy?: number | null;
    createdAt?: ApiDate;
}
export interface CostEntryPage {
    records?: CostEntry[] | null;
    total?: number | null;
    current?: number | null;
    size?: number | null;
    pages?: number | null;
}
export interface DerivedLabor {
    derived?: boolean | null;
    hours?: number | null;
    ratePerHour?: number | null;
    amount?: number | null;
}
export interface DerivedAiToken {
    derived?: boolean | null;
    tokens?: number | null;
    pricePerMillion?: number | null;
    amount?: number | null;
}
/** `GET …/cost`. status OK | NO_BUDGET | INSUFFICIENT_DATA (then `actual` may be null and nothing is summed). */
export interface CostSummary {
    productId?: number | null;
    releaseId?: number | null;
    weightBasis?: string | null;
    status?: string | null;
    message?: string | null;
    currency?: string | null;
    budget?: Budget | null;
    actual?: {
        byCategory?: Record<string, number | null> | null;
        manualTotal?: number | null;
        derivedLabor?: DerivedLabor | null;
        derivedAiToken?: DerivedAiToken | null;
        total?: number | null;
    } | null;
    remainingBudget?: number | null;
    costProgressPct?: number | null;
    developmentProgressPct?: number | null;
    timeProgressPct?: number | null;
    costVarianceVsProgress?: number | null;
    costPerScopeUnit?: number | null;
    estimateAtCompletion?: number | null;
    estimateVariance?: number | null;
    aiTokensConsumed?: number | null;
    warnings?: string[] | null;
}
export declare const CATEGORY_LABELS: Record<string, string>;
export declare function renderBudget(b: Budget, scope: {
    productId: number;
    releaseId?: number | null;
}, saved?: boolean): string;
export declare function renderCost(c: CostSummary): string;
export declare function renderCostEntries(page: CostEntryPage): string;
export declare function renderCostEntry(e: CostEntry, verb: string): string;
//# sourceMappingURL=renderCost.d.ts.map