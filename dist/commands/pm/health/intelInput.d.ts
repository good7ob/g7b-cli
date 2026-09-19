/**
 * CLI-boundary validation for the C2 what-if / explain / management-report commands (backend
 * WhatIfService, ProgressExplainService, ReportPeriod, ManagementReportService — api-0090 §11-§13).
 * Limits mirror the backend so a bad value is rejected here instead of as a 1001 round-trip.
 */
export declare const MAX_QUESTION = 500;
export declare const MAX_SCOPE = 1000000000;
export declare const MAX_EXTRA_CAPACITY = 1000000;
export declare const MIN_MULTIPLIER = 0.1;
export declare const MAX_MULTIPLIER = 10;
export declare const MAX_DEADLINE = "2100-01-01";
export declare const PERIOD_TYPES: readonly ["week", "month", "custom"];
/** Longest custom report period, both end days counted. */
export declare const MAX_REPORT_DAYS = 92;
/** A non-negative decimal within [min, max]. */
export declare function parseBounded(raw: string | undefined, label: string, min: number, max: number): number;
export interface WhatIfOptions {
    addScope?: string;
    removeScope?: string;
    velocityMultiplier?: string;
    extraCapacity?: string;
    deadline?: string;
    release?: string;
}
/** Every field is optional (no flag at all = "scenario equals baseline", which the backend answers with a warning). */
export declare function buildWhatIfBody(o: WhatIfOptions): Record<string, number | string>;
/** A blank question counts as "no question" (the backend then asks its default one). */
export declare function buildExplainBody(o: {
    release?: string;
    question?: string;
}): Record<string, number | string>;
export interface ReportOptions {
    period?: string;
    from?: string;
    to?: string;
    release?: string;
    ai?: boolean;
}
/** `POST …/reports/management` body; `useAi` is only sent when asked for. */
export declare function buildReportBody(o: ReportOptions, now?: Date): Record<string, unknown>;
export interface ReportListOptions {
    release?: string;
    period?: string;
    page?: string;
    pageSize?: string;
}
export declare function buildReportListParams(o: ReportListOptions): Record<string, string | number>;
/** `--out`: an absolute file path whose directory exists (checked before any HTTP call, so no report is generated for nothing). */
export declare function resolveOutPath(raw: string | undefined): string | undefined;
//# sourceMappingURL=intelInput.d.ts.map