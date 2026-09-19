import { ApiDate } from '../../utils/cliHelpers';
export interface Approval {
    id: number;
    orgId?: number | null;
    productId?: number | null;
    targetType?: string | null;
    targetId?: number | null;
    title?: string | null;
    description?: string | null;
    requestedBy?: number | null;
    status?: string | null;
    decidedBy?: number | null;
    decisionComment?: string | null;
    decidedAt?: ApiDate;
    selfApproved?: boolean | null;
    createdAt?: ApiDate;
    updatedAt?: ApiDate;
    canDecide?: boolean | null;
    canCancel?: boolean | null;
}
export declare function renderApprovalList(result: unknown, pageNum: number, pageSize: number): string;
export declare function renderApprovalDetail(a: Approval): string;
//# sourceMappingURL=render.d.ts.map