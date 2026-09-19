import { ApiDate } from '../../utils/cliHelpers';
export interface IdeaSolution {
    id: number;
    ideaId?: number;
    name?: string | null;
    description?: string | null;
    costNote?: string | null;
    cycleNote?: string | null;
    expectedEffectNote?: string | null;
    isSelected?: boolean | null;
    decisionReason?: string | null;
    decidedBy?: number | null;
    decidedAt?: ApiDate;
}
export interface Idea {
    id: number;
    productId?: number;
    title?: string | null;
    description?: string | null;
    source?: string | null;
    status?: string | null;
    priority?: string | null;
    expectedValue?: string | null;
    requirementId?: number | null;
    rejectReason?: string | null;
    createdBy?: number | null;
    createdAt?: ApiDate;
    updatedAt?: ApiDate;
}
export interface IdeaDetail {
    idea: Idea;
    solutions?: IdeaSolution[] | null;
}
export declare function renderIdeaList(result: unknown, pageNum: number, pageSize: number): string;
export declare function renderIdeaDetail(detail: IdeaDetail): string;
//# sourceMappingURL=render.d.ts.map