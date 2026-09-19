/**
 * CLI-boundary validation for the collaboration commands (comment / attachment / tag / relation /
 * merge / duplicates). Limits mirror IdeaCommentDto / IdeaAttachmentDto / IdeaTagService /
 * IdeaRelationDto / IdeaMergeDto; the attachment address check mirrors IdeaAttachmentStorageGuard.
 */
export declare const RELATION_TYPES: readonly ["related", "duplicate_of", "blocks"];
export declare const MAX_TAGS = 10;
export declare const MAX_COMMENT = 2000;
export declare const MAX_FILE_NAME = 255;
export declare const MAX_FILE_URL = 1000;
export declare const MAX_CONTENT_TYPE = 100;
export declare const MAX_FILE_BYTES: number;
export declare const MAX_DUPLICATES = 20;
type Body = Record<string, string | number>;
export declare function buildCommentBody(o: {
    text?: string;
    parent?: string;
}): Body;
export declare function buildCommentListParams(o: {
    page?: string;
    pageSize?: string;
}): Record<string, number>;
/**
 * The shape the backend accepts: https, an S3 host, a path under /public/, no query / fragment /
 * userinfo / path traversal. The bucket name itself is server config, so only the shape is checked.
 */
export declare function checkFileUrl(raw: string | undefined): string;
export declare function buildAttachmentBody(o: {
    name?: string;
    url?: string;
    contentType?: string;
    size?: string;
}): Body;
/**
 * `a,b,c` -> trimmed, lower-cased, de-duplicated (what the server stores anyway). An empty
 * string clears the tags.
 */
export declare function buildTagsBody(raw: string | undefined): {
    tags: string[];
};
export declare function buildRelationBody(ideaId: number, o: {
    to?: string;
    type?: string;
}): Body;
export declare function buildMergeBody(ideaId: number, into: string | undefined): {
    targetIdeaId: number;
};
export declare function buildDuplicatesParams(limit: string | undefined): Record<string, number> | undefined;
export {};
//# sourceMappingURL=collabInput.d.ts.map