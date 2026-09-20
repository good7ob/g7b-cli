import { ApiDate } from '../../utils/cliHelpers';
import { IdeaDecision, IdeaSolution } from './renderSolutions';
export type { IdeaDecision, IdeaSolution };
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
    releaseId?: number | null;
    rejectReason?: string | null;
    createdBy?: number | null;
    createdAt?: ApiDate;
    updatedAt?: ApiDate;
}
export interface IdeaDetail {
    idea: Idea;
    solutions?: IdeaSolution[] | null;
    decision?: IdeaDecision | null;
    tags?: string[] | null;
}
export declare function renderIdeaList(result: unknown, pageNum: number, pageSize: number): string;
export declare function renderIdeaDetail(detail: IdeaDetail): string;
//# sourceMappingURL=render.d.ts.map