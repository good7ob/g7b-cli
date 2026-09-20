/**
 * CLI-boundary validation for `idea change-set` (ChangeSetCreateDto / ChangeSetUpdateDto /
 * ChangeSetItemDto / ChangeSetQueryDto / ChangeSetApplyDto). Limits mirror ChangeSetItemFields.
 */
import { ErrorCodeMap } from '../../utils/cliHelpers';
export declare const CHANGE_SET_STATUSES: readonly ["draft", "impact_analyzed", "pending_approval", "approved", "applied", "rejected", "cancelled"];
export declare const OBJECT_TYPES: readonly ["PRD", "FP", "RP", "UI", "API", "DB", "ARCH", "TEST_CASE", "TASK", "OTHER"];
export declare const CHANGE_KINDS: readonly ["add", "update", "remove"];
export declare const MAX_CS_TITLE = 200;
export declare const MAX_CS_SUMMARY = 2000;
export declare const MAX_ITEM_DESCRIPTION = 1000;
export declare const MAX_OBJECT_REF = 300;
export declare const CHANGE_SET_ERROR_CODES: ErrorCodeMap;
type Body = Record<string, unknown>;
export declare function buildCreateBody(ideaId: number, o: {
    title?: string;
    solution?: string;
    summary?: string;
}): Body;
/** Omitted flag = unchanged (backend contract), so only send what was given. */
export declare function buildUpdateBody(o: {
    title?: string;
    summary?: string;
}): Body;
/** The backend requires ideaId or productId; the CLI takes exactly one (product may come from GOOD7OB_PRODUCT_ID). */
export declare function buildListParams(o: {
    idea?: string;
    product?: string;
    status?: string;
    page?: string;
    pageSize?: string;
}): Record<string, string | number>;
export interface ItemFlags {
    type?: string;
    kind?: string;
    description?: string;
    objectId?: string;
    objectRef?: string;
}
/** type / kind / description are mandatory and at least one of object id / ref must locate the object. */
export declare function buildItemAddBody(o: ItemFlags): Body;
export declare function buildItemUpdateBody(o: ItemFlags): Body;
export declare function buildApplyBody(o: {
    module?: string;
}): Body;
export {};
//# sourceMappingURL=changeSetInput.d.ts.map