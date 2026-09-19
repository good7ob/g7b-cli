/**
 * CLI-boundary validation for the B2 workspace commands: `ai-team`, `ai-team log`, `daily-report`,
 * `next-actions` (api-0089 §7-§9; WorkspaceAiTeamService, WorkspaceAiWorkLogService,
 * WorkspaceDailyReportService, WorkspaceNextActionService). The backend clamps paging silently; the CLI
 * refuses out-of-range values instead, so a typo is not mistaken for a result.
 */
export declare const AI_TEAM_STATUSES: readonly ["working", "waiting", "error", "idle", "all"];
export declare const MAX_LOG_PAGE_SIZE = 100;
export declare const MAX_LOG_RANGE_DAYS = 31;
export declare const MAX_NEXT_ACTIONS = 20;
export declare function buildAiTeamParams(o: {
    status?: string;
    org?: string;
}): Record<string, string | number>;
export interface WorkLogOptions {
    from?: string;
    to?: string;
    page?: string;
    pageSize?: string;
}
/** Range at most 31 days (checked when both ends are given; with only one end the backend defaults the other). */
export declare function buildWorkLogParams(o: WorkLogOptions): Record<string, string | number>;
/**
 * Report day: a real date, never in the future. The server judges "today" in its own zone, so the CLI
 * only refuses a day that is later than tomorrow in UTC (no zone is that far ahead); the server decides the edge.
 */
export declare function parseReportDate(raw: string, now?: Date): string;
export declare const buildDailyReportParams: (o: {
    date?: string;
}) => Record<string, string>;
/** `useAi` is only sent when asked for (the backend default is a deterministic report). */
export declare function buildDailyReportBody(o: {
    date?: string;
    ai?: boolean;
}): Record<string, string | boolean>;
export declare const buildNextActionsParams: (o: {
    limit?: string;
}) => Record<string, number>;
//# sourceMappingURL=aiTeamInput.d.ts.map