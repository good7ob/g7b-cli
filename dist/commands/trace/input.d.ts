/**
 * CLI-boundary validation for `trace` commands. Mirrors TraceLinkService: type codes are
 * 2-32 chars of A-Z/0-9/_ (case-insensitive), linkType is one of four, source/target
 * type+id come as pairs, page size is 1..200.
 */
import { ErrorCodeMap } from '../../utils/cliHelpers';
export declare const LINK_TYPES: readonly ["derived_from", "impacts", "implements", "verifies"];
export declare const MAX_PAGE_SIZE = 200;
export declare const TRACE_ERROR_CODES: ErrorCodeMap;
interface Flags {
    product?: string;
    sourceType?: string;
    sourceId?: string;
    targetType?: string;
    targetId?: string;
    linkType?: string;
}
export declare function buildCreateBody(o: Flags): Record<string, string | number>;
export declare function buildListParams(o: Flags & {
    page?: string;
    pageSize?: string;
}): Record<string, string | number>;
export {};
//# sourceMappingURL=input.d.ts.map