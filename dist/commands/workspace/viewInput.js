"use strict";
/**
 * CLI-boundary validation for `workspace tasks / products / product`. Mirrors
 * WorkspaceMyTaskGroupService / WorkspaceMyProductsService (api-0089): the backend would clamp
 * paging silently, the CLI refuses out-of-range values instead so a typo is not mistaken for a result.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProductsParams = exports.buildTasksParams = exports.MAX_URGENT_LIMIT = exports.MAX_PAGE_SIZE = exports.PRODUCT_SCOPES = exports.TASK_GROUPS = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.TASK_GROUPS = ['today', 'todo', 'in_progress', 'waiting', 'blocked', 'done'];
exports.PRODUCT_SCOPES = ['all', 'owned', 'participating', 'following', 'archived'];
exports.MAX_PAGE_SIZE = 100;
/** Without --group the backend answers with the MVP summary + N most urgent tasks (1..50, default 5). */
exports.MAX_URGENT_LIMIT = 50;
/** `group` set -> paged group query; unset -> MVP "summary + most urgent" query. Flags of the other mode are refused. */
function buildTasksParams(o) {
    if (o.group === undefined) {
        if (o.page !== undefined || o.pageSize !== undefined) {
            throw new cliHelpers_1.InputError('--page / --page-size 需要同时指定 --group（不带 --group 时只显示摘要和最紧急的任务，用 --limit 调数量）');
        }
        return o.limit === undefined ? {} : { limit: (0, cliHelpers_1.parseIntInRange)(o.limit, '--limit', 1, exports.MAX_URGENT_LIMIT) };
    }
    if (o.limit !== undefined) {
        throw new cliHelpers_1.InputError('--limit 只用于不带 --group 的摘要视图；分组视图请用 --page / --page-size');
    }
    return {
        group: (0, cliHelpers_1.requireOneOf)(o.group.trim().toLowerCase(), exports.TASK_GROUPS, '--group'),
        pageNum: (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000),
        pageSize: (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '20', '--page-size', 1, exports.MAX_PAGE_SIZE),
    };
}
exports.buildTasksParams = buildTasksParams;
function buildProductsParams(o) {
    return o.scope === undefined ? {} : { scope: (0, cliHelpers_1.requireOneOf)(o.scope.trim().toLowerCase(), exports.PRODUCT_SCOPES, '--scope') };
}
exports.buildProductsParams = buildProductsParams;
//# sourceMappingURL=viewInput.js.map