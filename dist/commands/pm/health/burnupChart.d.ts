/** Tiny text charts for `pm health burnup`. Null values are gaps, never zeros. */
/** At most `max` values, evenly spread, always keeping the last (most recent) one. */
export declare function downsample<T>(values: T[], max?: number): T[];
/** One block char per value, all on the scale 0..`ceiling`; null -> a space. */
export declare function sparkline(values: (number | null | undefined)[], ceiling: number): string;
/** `████████░░░░` — `completed` filled out of `scope`; empty when either is unknown. */
export declare function progressBar(completed: number | null | undefined, scope: number | null | undefined, width?: number): string;
//# sourceMappingURL=burnupChart.d.ts.map