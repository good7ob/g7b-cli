/**
 * CLI-boundary validation for `workspace queue` commands. Mirrors WorkspaceQueueService /
 * WorkQueueActionService (api-0089) so a bad value is rejected here with a clear message
 * instead of as a 1000/1001 round-trip.
 */
import { ErrorCodeMap } from '../../utils/cliHelpers';
export declare const QUEUE_STATUSES: readonly ["active", "snoozed", "dismissed", "done", "all", "new", "in_progress", "waiting"];
export declare const ACTION_TYPES: readonly ["PLAN_APPROVAL", "COMPLETION_APPROVAL", "INFO_REQUEST", "BLOCKED", "PAUSED", "SYSTEM_ALERT", "REQUIREMENT_TRIAGE", "APPROVAL", "RISK_ALERT"];
export type Decision = 'approve' | 'reject';
export declare const MAX_QUEUE_LIMIT = 200;
export declare const MAX_SNOOZE_DAYS = 30;
/** Codes every workspace endpoint can answer with. 1002 also covers "not yours" (ids of others never leak). */
export declare const WORKSPACE_ERROR_CODES: ErrorCodeMap;
/** Extra meaning of the codes when deciding an item in place (`approve` / `reject`). */
export declare const ACTION_ERROR_CODES: ErrorCodeMap;
export declare function buildQueueParams(o: {
    limit?: string;
    status?: string;
    actionType?: string;
    product?: string;
}): Record<string, string | number>;
/**
 * `--until` -> the UTC instant the backend expects (`yyyy-MM-ddTHH:mm:ssZ`). Accepts an ISO
 * date-time (no offset = UTC, as the backend reads it) or `+<n>m|h|d` relative to `now`.
 * Rejects what the backend would (not in the future, more than 30 days ahead) up front.
 */
export declare function parseSnoozeUntil(raw: string | undefined, now?: Date): string;
/** approve: comment optional (the backend records it for APPROVAL items only). reject: required, non-blank. */
export declare function buildActionBody(action: Decision, comment: string | undefined): {
    action: Decision;
    comment?: string;
};
//# sourceMappingURL=input.d.ts.map