"use strict";
/**
 * Shared plumbing for bulk import commands (prd import-structure, schema import):
 * a bounded worker pool and a 429-aware retry wrapper.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimitRetry = exports.DEFAULT_RETRY_DELAYS_MS = exports.runPool = void 0;
/** Run `worker` over `items` with at most `limit` in flight; the first failure stops new work and rejects. */
async function runPool(items, limit, worker) {
    let next = 0;
    let failed = false;
    const lane = async () => {
        while (!failed && next < items.length) {
            const item = items[next++];
            try {
                await worker(item);
            }
            catch (e) {
                failed = true;
                throw e;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}
exports.runPool = runPool;
exports.DEFAULT_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000];
const isRateLimited = (m) => /Too many requests|429|请求过于频繁/i.test(m);
/**
 * Bulk imports are thousands of writes and the backend rate-limits per user: back off on 429,
 * fail fast on anything else (imports are idempotent, so a rerun resumes). Errors are prefixed with `id`.
 */
function rateLimitRetry(delaysMs = exports.DEFAULT_RETRY_DELAYS_MS) {
    return async (id, call) => {
        for (let attempt = 0;; attempt++) {
            try {
                return await call();
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (isRateLimited(msg) && attempt < delaysMs.length) {
                    await new Promise((r) => setTimeout(r, delaysMs[attempt]));
                    continue;
                }
                throw new Error(`${id}: ${msg}`);
            }
        }
    };
}
exports.rateLimitRetry = rateLimitRetry;
//# sourceMappingURL=pool.js.map