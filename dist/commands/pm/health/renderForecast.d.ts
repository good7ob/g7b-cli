/** Renderers for `pm health forecast` and `pm health what-if` (api-0090 §8, §11). */
export interface ForecastSample {
    weekStart?: string | null;
    completed?: number | null;
}
/** `GET /progress/products/{id}/forecast`. status OK | INSUFFICIENT_DATA; on the latter every date / week figure is null. */
export interface Forecast {
    productId?: number | null;
    releaseId?: number | null;
    weightBasis?: string | null;
    status?: string | null;
    message?: string | null;
    asOfDate?: string | null;
    remainingScope?: number | null;
    sampleWeeks?: number | null;
    activeWeeks?: number | null;
    iterations?: number | null;
    horizonWeeks?: number | null;
    p50Weeks?: number | null;
    p80Weeks?: number | null;
    p50Date?: string | null;
    p80Date?: string | null;
    notConverging?: boolean | null;
    plannedEndDate?: string | null;
    p50VarianceDays?: number | null;
    p80VarianceDays?: number | null;
    samples?: ForecastSample[] | null;
}
export declare const NO_DATA = "\u6570\u636E\u4E0D\u8DB3";
export declare const releaseLabel: (releaseId?: number | null) => string;
export declare function renderForecast(f: Forecast): string;
export interface Scenario {
    remaining?: number | null;
    velocity?: number | null;
    p50Weeks?: number | null;
    p80Weeks?: number | null;
    p50Date?: string | null;
    p80Date?: string | null;
    notConverging?: boolean | null;
    estimateAtCompletion?: number | null;
}
export interface DeadlineCheck {
    p50?: boolean | null;
    p80?: boolean | null;
}
export interface CostImpact {
    currency?: string | null;
    baselineEstimateAtCompletion?: number | null;
    scenarioEstimateAtCompletion?: number | null;
    delta?: number | null;
}
/** `POST /progress/products/{id}/what-if`: a pure simulation, nothing is stored. */
export interface WhatIf {
    productId?: number | null;
    releaseId?: number | null;
    weightBasis?: string | null;
    status?: string | null;
    message?: string | null;
    baseline?: Scenario | null;
    scenario?: Scenario | null;
    deltaDays?: number | null;
    deltaDaysP80?: number | null;
    deadline?: string | null;
    meetsDeadline?: DeadlineCheck | null;
    baselineMeetsDeadline?: DeadlineCheck | null;
    costImpact?: CostImpact | null;
    warnings?: string[] | null;
}
export declare function renderWhatIf(w: WhatIf): string;
//# sourceMappingURL=renderForecast.d.ts.map