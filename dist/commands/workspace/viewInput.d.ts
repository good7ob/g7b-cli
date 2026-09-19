/**
 * CLI-boundary validation for `workspace tasks / products / product`. Mirrors
 * WorkspaceMyTaskGroupService / WorkspaceMyProductsService (api-0089): the backend would clamp
 * paging silently, the CLI refuses out-of-range values instead so a typo is not mistaken for a result.
 */
export declare const TASK_GROUPS: readonly ["today", "todo", "in_progress", "waiting", "blocked", "done"];
export declare const PRODUCT_SCOPES: readonly ["all", "owned", "participating", "following", "archived"];
export declare const MAX_PAGE_SIZE = 100;
/** Without --group the backend answers with the MVP summary + N most urgent tasks (1..50, default 5). */
export declare const MAX_URGENT_LIMIT = 50;
export interface TasksOptions {
    group?: string;
    page?: string;
    pageSize?: string;
    limit?: string;
}
/** `group` set -> paged group query; unset -> MVP "summary + most urgent" query. Flags of the other mode are refused. */
export declare function buildTasksParams(o: TasksOptions): Record<string, string | number>;
export declare function buildProductsParams(o: {
    scope?: string;
}): Record<string, string>;
//# sourceMappingURL=viewInput.d.ts.map