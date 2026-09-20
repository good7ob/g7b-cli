import { ApiDate } from '../../utils/cliHelpers';
/** Renderers for `workspace tasks / products / orgs`; overview (renderOverview.ts) reuses the product table and counters. */
export interface MyTask {
    id?: number | null;
    name?: string | null;
    status?: string | null;
    priority?: string | null;
    deadline?: ApiDate;
    projectId?: number | null;
    projectName?: string | null;
    productId?: number | null;
    progress?: number | null;
    executorType?: string | null;
}
export type TaskGroupCounts = Record<string, number | null>;
/** Paged result of `GET /workspace/my-tasks?group=…`. */
export interface MyTaskGroup {
    group?: string | null;
    pageNum?: number | null;
    pageSize?: number | null;
    total?: number | null;
    counts?: TaskGroupCounts | null;
    items?: MyTask[] | null;
}
/** MVP result of `GET /workspace/my-tasks` without a group. */
export interface MyTasksSummary {
    total?: number | null;
    summary?: Record<string, number | null> | null;
    items?: MyTask[] | null;
}
export interface MyProduct {
    productId?: number | null;
    name?: string | null;
    orgId?: number | null;
    orgName?: string | null;
    status?: string | null;
    archived?: boolean | null;
    owned?: boolean | null;
    participating?: boolean | null;
    following?: boolean | null;
    myOpenTasks?: number | null;
    blockedCount?: number | null;
    aiWorkingCount?: number | null;
    progress?: number | null;
    riskLevel?: string | null;
}
export interface MyProducts {
    scope?: string | null;
    total?: number | null;
    items?: MyProduct[] | null;
}
export interface MyOrg {
    orgId?: number | null;
    name?: string | null;
    myRole?: string | null;
    memberCount?: number | null;
    aiEmployeeCount?: number | null;
    productCount?: number | null;
    activeTaskCount?: number | null;
}
export interface MyOrgs {
    total?: number | null;
    items?: MyOrg[] | null;
}
/** `今日 5  待开始 3 …` — groups overlap, so these never add up to a total. */
export declare const renderTaskCounts: (counts?: TaskGroupCounts | null) => string;
export declare function renderTaskGroup(vo: MyTaskGroup): string;
export declare function renderMyTasks(vo: MyTasksSummary): string;
/** Product cards as a table; `progress`/`riskLevel` are null for cards the backend did not evaluate (noted below the table). */
export declare function productTable(items: MyProduct[]): string;
export declare function renderProducts(vo: MyProducts): string;
export declare function renderOrgs(vo: MyOrgs): string;
//# sourceMappingURL=renderViews.d.ts.map