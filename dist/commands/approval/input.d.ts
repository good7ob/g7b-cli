/**
 * CLI-boundary validation for `approval` commands. Mirrors ApprovalService: status and
 * targetType are validated, page size is 1..100, a rejection needs a non-blank comment.
 */
import { ErrorCodeMap } from '../../utils/cliHelpers';
export declare const STATUSES: readonly ["pending", "approved", "rejected", "cancelled"];
export declare const MAX_PAGE_SIZE = 100;
export declare const APPROVAL_ERROR_CODES: ErrorCodeMap;
export declare function buildListParams(o: {
    status?: string;
    targetType?: string;
    targetId?: string;
    product?: string;
    mine?: boolean;
    page?: string;
    pageSize?: string;
}): Record<string, string | number | boolean>;
/** Approve: comment optional. Reject: comment required and non-blank. */
export declare function buildDecisionBody(comment: string | undefined, required: boolean): Record<string, string>;
//# sourceMappingURL=input.d.ts.map