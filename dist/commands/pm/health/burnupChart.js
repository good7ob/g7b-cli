"use strict";
/** Tiny text charts for `pm health burnup`. Null values are gaps, never zeros. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.progressBar = exports.sparkline = exports.downsample = void 0;
const SPARK = '▁▂▃▄▅▆▇█';
const MAX_SPARK_WIDTH = 60;
/** At most `max` values, evenly spread, always keeping the last (most recent) one. */
function downsample(values, max = MAX_SPARK_WIDTH) {
    if (values.length <= max)
        return values;
    return Array.from({ length: max }, (_, i) => values[Math.round((i * (values.length - 1)) / (max - 1))]);
}
exports.downsample = downsample;
/** One block char per value, all on the scale 0..`ceiling`; null -> a space. */
function sparkline(values, ceiling) {
    return values
        .map((v) => {
        if (v == null || Number.isNaN(v))
            return ' ';
        if (ceiling <= 0)
            return SPARK[0];
        const level = Math.round((Math.max(0, Math.min(v, ceiling)) / ceiling) * (SPARK.length - 1));
        return SPARK[level];
    })
        .join('');
}
exports.sparkline = sparkline;
/** `████████░░░░` — `completed` filled out of `scope`; empty when either is unknown. */
function progressBar(completed, scope, width = 20) {
    if (completed == null || scope == null || scope <= 0)
        return '';
    const filled = Math.round((Math.max(0, Math.min(completed, scope)) / scope) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}
exports.progressBar = progressBar;
//# sourceMappingURL=burnupChart.js.map