/**
 * Shared plumbing for bulk import commands (prd import-structure, schema import):
 * a bounded worker pool and a 429-aware retry wrapper.
 */
/** Run `worker` over `items` with at most `limit` in flight; the first failure stops new work and rejects. */
export declare function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void>;
export declare const DEFAULT_RETRY_DELAYS_MS: number[];
/**
 * Bulk imports are thousands of writes and the backend rate-limits per user: back off on 429,
 * fail fast on anything else (imports are idempotent, so a rerun resumes). Errors are prefixed with `id`.
 */
export declare function rateLimitRetry(delaysMs?: number[]): <T>(id: string, call: () => Promise<T>) => Promise<T>;
//# sourceMappingURL=pool.d.ts.map