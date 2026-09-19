/**
 * CLI-boundary validation for `idea` commands. Limits mirror the backend DTOs
 * (IdeaCreateDto / IdeaUpdateDto / IdeaSolution*Dto) so a bad value is rejected
 * here with a clear message instead of as a 1001 round-trip.
 */
import { ErrorCodeMap } from '../../utils/cliHelpers';
export declare const SOURCES: readonly ["customer", "feedback", "pm", "dev", "ai", "ops", "bug", "competitor", "market", "management"];
export declare const PRIORITIES: readonly ["low", "medium", "high"];
export declare const STATUSES: readonly ["draft", "evaluating", "approved", "rejected", "archived"];
export declare const TRANSITIONS: readonly ["evaluating", "archived"];
export declare const MAX_TITLE = 200;
export declare const MAX_EXPECTED_VALUE = 500;
export declare const MAX_SOLUTION_NAME = 200;
export declare const MAX_SOLUTION_NOTE = 500;
export declare const MAX_REASON = 1000;
export declare const MAX_PAGE_SIZE = 100;
export declare const IDEA_ERROR_CODES: ErrorCodeMap;
/** Raw commander options -> validated request pieces. All throw before any HTTP call. */
export declare function buildListParams(o: {
    product?: string;
    status?: string;
    keyword?: string;
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
export declare function buildUpdateBody(o: IdeaFlags): Record<string, string>;
interface SolutionFlags {
    name?: string;
    description?: string;
    costNote?: string;
    cycleNote?: string;
    effectNote?: string;
}
export declare function buildSolutionCreateBody(o: SolutionFlags): Record<string, string>;
export declare function buildSolutionUpdateBody(o: SolutionFlags): Record<string, string>;
export declare function buildReasonBody(field: 'reason' | 'decisionReason', raw: string | undefined): Record<string, string>;
export {};
//# sourceMappingURL=input.d.ts.map