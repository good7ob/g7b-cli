import { ApiDate } from '../../utils/cliHelpers';
export interface ChangeSet {
    id: number;
    ideaId?: number;
    productId?: number;
    solutionId?: number | null;
    code?: string | null;
    title?: string | null;
    summary?: string | null;
    status?: string | null;
    approvalId?: number | null;
    moduleId?: number | null;
    createdBy?: number | null;
    appliedBy?: number | null;
    appliedAt?: ApiDate;
    createdAt?: ApiDate;
    updatedAt?: ApiDate;
}
export interface ChangeSetItem {
    id: number;
    objectType?: string | null;
    objectId?: number | null;
    objectRef?: string | null;
    changeKind?: string | null;
    description?: string | null;
    source?: string | null;
    confidence?: string | null;
    isConfirmed?: boolean | null;
    taskId?: number | null;
}
export interface ChangeSetDetail {
    changeSet: ChangeSet;
    items?: ChangeSetItem[] | null;
}
export interface AnalyzeResult extends ChangeSetDetail {
    added?: {
        trace?: number | null;
        ai?: number | null;
    } | null;
    warning?: string | null;
}
export interface ApplyResult {
    changeSet: ChangeSet;
    moduleId?: number | null;
    tasks?: Array<{
        itemId: number;
        taskId: number;
    }> | null;
    traceLinks?: number | null;
    ideaStatus?: string | null;
    summary?: string | null;
}
export declare function renderChangeSetList(result: unknown, pageNum: number, pageSize: number): string;
export declare function renderItems(items: ChangeSetItem[]): string;
export declare function renderChangeSetDetail(detail: ChangeSetDetail): string;
export declare function renderAnalyze(result: AnalyzeResult): string;
export declare function renderApply(result: ApplyResult): string;
//# sourceMappingURL=changeSetRender.d.ts.map