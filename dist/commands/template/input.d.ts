/**
 * CLI-boundary validation for `template` commands. Enums and limits mirror the backend
 * (com.remostudio.template: TemplateType, TemplateRules, TemplateTagService, TemplateSearchDto) so a bad
 * value is rejected here with a clear message instead of as a 1001 round-trip.
 */
import { ErrorCodeMap } from '../../utils/cliHelpers';
import { PayloadFlags } from './versionInput';
export declare const TEMPLATE_TYPES: readonly ["PRD", "PROJECT", "TASK", "UI", "API", "DB", "TEST", "ARCH", "AI_PROMPT", "AGENT_SKILL", "WORKFLOW", "RELEASE"];
export declare const VISIBILITIES: readonly ["PUBLIC", "ORGANIZATION", "PRIVATE"];
export declare const STATUSES: readonly ["DRAFT", "REVIEWING", "REJECTED", "PUBLISHED", "SUSPENDED", "ARCHIVED"];
export declare const LICENSES: readonly ["PERSONAL", "ORGANIZATION", "COMMERCIAL", "ENTERPRISE"];
export declare const PRICINGS: readonly ["FREE", "ONE_TIME", "SUBSCRIPTION", "PRIVATE"];
export declare const SORTS: readonly ["latest", "popular", "rating", "installs"];
export declare const TAG_KINDS: readonly ["GENERAL", "INDUSTRY", "TECH_STACK", "LANGUAGE", "PLATFORM"];
export declare const MAX_NAME = 100;
export declare const MAX_DESCRIPTION = 2000;
export declare const MAX_TAGS = 10;
export declare const MAX_TAG_LENGTH = 30;
export declare const MAX_PAGE_SIZE = 50;
export declare const oneOf: (values: readonly string[]) => string;
export declare const TEMPLATE_ERROR_CODES: ErrorCodeMap;
/** Case-insensitive enum (the server upper-cases too); returns the canonical upper-case value. */
export declare function upperOneOf<T extends string>(raw: string, allowed: readonly T[], label: string): T;
export declare function pageParams(o: {
    page?: string;
    pageSize?: string;
}): {
    pageNum: number;
    pageSize: number;
};
/** `a,b,c` -> ['a','b','c']: trimmed, blanks dropped, case-insensitively de-duplicated, <=10 names of 1-30 chars. */
export declare function parseTags(raw: string, flag?: string): string[];
export interface SearchFlags {
    keyword?: string;
    type?: string;
    category?: string;
    tag?: string[];
    industry?: string;
    techStack?: string;
    language?: string;
    platform?: string;
    pricing?: string;
    minRating?: string;
    author?: string;
    official?: boolean;
    sort?: string;
    page?: string;
    pageSize?: string;
}
/**
 * GET /templates request. `tag` may repeat (all must match), and axios would serialise an array as `tag[]=…`
 * which Spring does not bind, so the tags go into the URL as plain repeated `tag=` pairs.
 */
export declare function buildSearchRequest(o: SearchFlags): {
    url: string;
    params: Record<string, string | number | boolean>;
};
/** `mine` / `org`: optional status + type filters and paging. */
export declare function buildListParams(o: {
    status?: string;
    type?: string;
    page?: string;
    pageSize?: string;
}): Record<string, string | number>;
export declare function buildTagsParams(o: {
    kind?: string;
    keyword?: string;
    limit?: string;
}): Record<string, string | number>;
export interface MetaFlags {
    name?: string;
    description?: string;
    category?: string;
    visibility?: string;
    tags?: string;
    license?: string;
}
type Body = Record<string, unknown>;
export interface FirstVersionFlags extends PayloadFlags {
    version?: string;
}
export declare function buildCreateBody(o: MetaFlags & FirstVersionFlags & {
    type?: string;
    org?: string;
}): Body;
/** Omitted flag = field unchanged (backend contract), so only send what was given. */
export declare function buildUpdateBody(o: MetaFlags & {
    clearTags?: boolean;
    resubmitForReview?: boolean;
}): Body;
export {};
//# sourceMappingURL=input.d.ts.map