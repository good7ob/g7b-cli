/**
 * CLI-boundary validation for `idea review` (EffectReviewUpdateDto / EffectMetricDto). Limits mirror
 * EffectReviewService: <= 20 metrics, name <= 100, unit <= 20, values with <= 4 decimals, notes <= 2000.
 */
import { ErrorCodeMap } from '../../utils/cliHelpers';
export declare const MAX_METRICS = 20;
export declare const MAX_METRIC_NAME = 100;
export declare const MAX_METRIC_UNIT = 20;
export declare const MAX_NOTES = 2000;
export declare const REVIEW_ERROR_CODES: ErrorCodeMap;
export interface MetricInput {
    name: string;
    expected: number | null;
    actual: number | null;
    unit: string | null;
}
/** `name[:expected[:actual[:unit]]]`; leave a part empty to mean "not available", e.g. `NPS:40::pts`. */
export declare function parseMetric(raw: string): MetricInput;
/** `--metric` replaces the whole list (backend contract); `--clear-metrics` empties it; notes null = unchanged. */
export declare function buildReviewUpdateBody(o: {
    metric?: string[];
    clearMetrics?: boolean;
    notes?: string;
}): Record<string, unknown>;
//# sourceMappingURL=reviewInput.d.ts.map