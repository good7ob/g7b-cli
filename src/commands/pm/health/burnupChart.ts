/** Tiny text charts for `pm health burnup`. Null values are gaps, never zeros. */

const SPARK = '▁▂▃▄▅▆▇█';
const MAX_SPARK_WIDTH = 60;

/** At most `max` values, evenly spread, always keeping the last (most recent) one. */
export function downsample<T>(values: T[], max = MAX_SPARK_WIDTH): T[] {
  if (values.length <= max) return values;
  return Array.from({ length: max }, (_, i) => values[Math.round((i * (values.length - 1)) / (max - 1))]);
}

/** One block char per value, all on the scale 0..`ceiling`; null -> a space. */
export function sparkline(values: (number | null | undefined)[], ceiling: number): string {
  return values
    .map((v) => {
      if (v == null || Number.isNaN(v)) return ' ';
      if (ceiling <= 0) return SPARK[0];
      const level = Math.round((Math.max(0, Math.min(v, ceiling)) / ceiling) * (SPARK.length - 1));
      return SPARK[level];
    })
    .join('');
}

/** `████████░░░░` — `completed` filled out of `scope`; empty when either is unknown. */
export function progressBar(completed: number | null | undefined, scope: number | null | undefined, width = 20): string {
  if (completed == null || scope == null || scope <= 0) return '';
  const filled = Math.round((Math.max(0, Math.min(completed, scope)) / scope) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
