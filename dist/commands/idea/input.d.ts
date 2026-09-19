/**
 * CLI-boundary validation for `idea` commands. Limits mirror the backend DTOs
 * (IdeaCreateDto / IdeaUpdateDto / IdeaSolution*Dto) so a bad value is rejected
 * here with a clear message instead of as a 1001 round-trip.
 */
import { ErrorCodeMap } from '../../utils/cliHelpers';
export declare const SOURCES: readonly ["customer", "feedback", "pm", "dev", "ai", "ops", "bug", "competitor", "market", "management"];
export declare const PRIORITIES: readonly ["low", "medium", "high"];
export declare const STATUSES: readonly ["draft", "evaluating", "approved", "rejected", "archived", "planning", "developing", "released", "validated"];
/** approved / rejected are only reachable through `idea select` / `idea reject`. */
export declare const TRANSITIONS: readonly ["evaluating", "archived", "planning", "developing", "released", "validated"];
export declare const MAX_TITLE = 200;
export declare const MAX_EXPECTED_VALUE = 500;
export declare const MAX_REASON = 1000;
export declare const MAX_PAGE_SIZE = 100;
export declare const MAX_TAG_LENGTH = 30;
export declare const IDEA_ERROR_CODES: ErrorCodeMap;
/** Raw commander options -> validated request pieces. All throw before any HTTP call. */
export declare function buildListParams(o: {
    product?: string;
    status?: string;
    keyword?: string;
    tag?: string;
    release?: string;
    page?: string;
    pageSize?: string;
}): Record<string, string | number>;
interface IdeaFlags {
    title?: string;
    description?: string;
    source?: string;
    priority?: string;
    expectedValue?: string;
}
export declare function buildCreateBody(o: IdeaFlags & {
    product?: string;
}): Record<string, string | number>;
/** Omitted flag = field unchanged (backend contract), so only send what was given. */
export declare function buildUpdateBody(o: IdeaFlags & {
    release?: string;
    clearRelease?: boolean;
}): Record<string, string | number | boolean>;
/** approved / rejected get a pointer to the command that does reach them. */
export declare function parseTransition(raw: string): (typeof TRANSITIONS)[number];
export declare function buildReasonBody(field: 'reason' | 'decisionReason', raw: string | undefined): Record<string, string>;
/** `<solutionId>:<text>` (split on the first colon) -> {solutionId, reason}. */
export declare function parseRejectedReason(raw: string): {
    solutionId: number;
    reason: string;
};
/** Body of POST .../select. Without the new options it is exactly the MVP body {decisionReason}. */
export declare function buildSelectBody(solutionId: number, o: {
    reason?: string;
    rejectedReason?: string[];
    requireApproval?: boolean;
}): Record<string, unknown>;
export {};
//# sourceMappingURL=input.d.ts.map