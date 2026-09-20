import { ApiDate } from '../../utils/cliHelpers';
export interface Release {
    id: number;
    productId?: number;
    name?: string | null;
    version?: string | null;
    description?: string | null;
    status?: string | null;
    plannedStartDate?: string | null;
    plannedEndDate?: string | null;
    releasedAt?: ApiDate;
    createdBy?: number | null;
    createdAt?: ApiDate;
    updatedAt?: ApiDate;
    taskCount?: number | null;
    /** Only present on detail and request-approval responses. */
    pendingApprovalId?: number | null;
}
export interface ReleaseTask {
    id: number;
    name?: string | null;
    status?: string | null;
    progress?: number | null;
    projectId?: number | null;
    responsibleId?: number | null;
}
export declare function renderReleaseList(releases: Release[]): string;
export declare function renderReleaseDetail(r: Release): string;
export declare function renderReleaseTasks(tasks: ReleaseTask[]): string;
//# sourceMappingURL=render.d.ts.map