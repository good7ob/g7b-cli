/**
 * CLI-boundary validation for the C1 progress commands (config, scope changes, burnup,
 * snapshot rebuild, release baseline). Limits mirror the backend (ProgressConfigService,
 * ScopeChangeService, BurnupService, ProgressSnapshotService) so a bad value is rejected here
 * with a clear message instead of as a 1001 round-trip.
 */
import { ErrorCodeMap } from '../../../utils/cliHelpers';
/** The NEW endpoints (Result envelope). The old /health* ones keep the 40xxx codes. */
export declare const PROGRESS_ERROR_CODES: ErrorCodeMap;
export declare const WEIGHT_BASES: readonly ["ESTIMATED_HOURS", "STORY_POINT", "WEIGHT"];
/** Statuses whose completion can be overridden; completed (always 100) and cancelled (out of scope) cannot. */
export declare const OVERRIDABLE_STATUSES: readonly ["not_started", "pending_agent", "pending_info", "awaiting_plan_approval", "in_progress", "paused", "awaiting_completion_approval", "blocked"];
export declare const MAX_REASON = 500;
export declare const MAX_NOTE = 500;
export declare const MAX_PAGE_SIZE = 100;
export declare const MAX_REBUILD_DAYS = 90;
export declare const MAX_BURNUP_SPAN_DAYS = 366;
/** `in_progress=30,blocked=50` -> { in_progress: 30, blocked: 50 }. */
export declare function parseStatusCompletion(raw: string): Record<string, number>;
/** PUT replaces the whole config: omitting --status-completion clears any existing overrides. */
export declare function buildConfigBody(o: {
    basis?: string;
    statusCompletion?: string;
}): {
    weightBasis: string;
    statusCompletion?: Record<string, number>;
};
export declare function buildScopeChangesParams(o: {
    release?: string;
    page?: string;
    pageSize?: string;
}): Record<string, number>;
export declare function parseDelta(raw: string | undefined): number;
export declare function buildScopeChangeBody(o: {
    delta?: string;
    reason?: string;
    release?: string;
}): {
    deltaScope: number;
    reason: string;
    releaseId?: number;
};
export declare function buildAnnotateBody(reason: string | undefined): {
    reason: string;
};
export declare function buildBurnupParams(o: {
    from?: string;
    to?: string;
    release?: string;
}): Record<string, string | number>;
/** `/snapshots/rebuild?days=N`, or no query at all (the backend defaults to 30). */
export declare function rebuildUrl(productId: number, days?: string): string;
/** Optional note; blank counts as "no note" (the backend trims it the same way). */
export declare function buildNoteBody(note: string | undefined): {
    note?: string;
};
//# sourceMappingURL=input.d.ts.map