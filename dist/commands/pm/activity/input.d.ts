/**
 * CLI-boundary validation for `pm activity` (prd-0092 FP-6, api-0092): exactly one of
 * --project / --task; `--since` switches from page mode (pageNum/pageSize) to cursor mode
 * (sinceId/limit); `--type` / `--actor` filters exist only on the project endpoint.
 */
import { ErrorCodeMap } from '../../../utils/cliHelpers';
export declare const ACTOR_TYPES: readonly ["USER", "AGENT", "SYSTEM"];
export declare const POST_TYPES: readonly ["NOTE", "REPORT_UPLOADED"];
export declare const MAX_PAGE_SIZE = 200;
export declare const MAX_LIMIT = 200;
export declare const MAX_SUMMARY = 500;
export declare const ACTIVITY_ERROR_CODES: ErrorCodeMap;
export interface ListFlags {
    project?: string;
    task?: string;
    since?: string;
    type?: string;
    actor?: string;
    limit?: string;
    page?: string;
    pageSize?: string;
}
export interface ListTarget {
    url: string;
    params: Record<string, string | number>;
}
export declare function buildListTarget(o: ListFlags): ListTarget;
export interface PostFlags {
    task?: string;
    summary?: string;
    type?: string;
    url?: string;
}
export interface PostBody {
    type: string;
    summary: string;
    metadata?: {
        url: string;
    };
}
export declare function buildPostBody(o: PostFlags): {
    taskId: number;
    body: PostBody;
};
//# sourceMappingURL=input.d.ts.map