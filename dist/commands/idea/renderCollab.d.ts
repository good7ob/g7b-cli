import { ApiDate } from '../../utils/cliHelpers';
export interface IdeaComment {
    id: number;
    ideaId?: number;
    authorId?: number | null;
    content?: string | null;
    parentId?: number | null;
    createdAt?: ApiDate;
}
export interface IdeaAttachment {
    id: number;
    ideaId?: number;
    fileName?: string | null;
    fileUrl?: string | null;
    contentType?: string | null;
    sizeBytes?: number | null;
    uploadedBy?: number | null;
    createdAt?: ApiDate;
}
export interface IdeaRelation {
    id: number;
    relationType?: string | null;
    direction?: string | null;
    otherIdeaId?: number | null;
    otherTitle?: string | null;
    otherStatus?: string | null;
    createdAt?: ApiDate;
}
export interface DuplicateCandidate {
    ideaId: number;
    title?: string | null;
    status?: string | null;
    similarity?: number | null;
}
export interface MergeResult {
    sourceIdeaId?: number | null;
    targetIdeaId?: number | null;
    movedSolutions?: number | null;
    movedComments?: number | null;
    movedAttachments?: number | null;
    movedTags?: number | null;
}
export declare function renderComments(result: unknown, pageNum: number, pageSize: number): string;
/** 1536 -> "1.5 KB"; null -> —. */
export declare function fmtBytes(bytes: number | null | undefined): string;
export declare function renderAttachments(list: IdeaAttachment[]): string;
export declare function renderRelations(list: IdeaRelation[]): string;
export declare function renderDuplicates(list: DuplicateCandidate[]): string;
export declare function renderMerge(id: number, targetId: number, r: MergeResult | null): string;
//# sourceMappingURL=renderCollab.d.ts.map