/**
 * CLI-boundary validation for `workspace tasks / products / product`. Mirrors
 * WorkspaceMyTaskGroupService / WorkspaceMyProductsService (api-0089): the backend would clamp
 * paging silently, the CLI refuses out-of-range values instead so a typo is not mistaken for a result.
 */

import { InputError, parseIntInRange, requireOneOf } from '../../utils/cliHelpers';

export const TASK_GROUPS = ['today', 'todo', 'in_progress', 'waiting', 'blocked', 'done'] as const;
export const PRODUCT_SCOPES = ['all', 'owned', 'participating', 'following', 'archived'] as const;

export const MAX_PAGE_SIZE = 100;
/** Without --group the backend answers with the MVP summary + N most urgent tasks (1..50, default 5). */
export const MAX_URGENT_LIMIT = 50;

export interface TasksOptions { group?: string; page?: string; pageSize?: string; limit?: string }

/** `group` set -> paged group query; unset -> MVP "summary + most urgent" query. Flags of the other mode are refused. */
export function buildTasksParams(o: TasksOptions): Record<string, string | number> {
  if (o.group === undefined) {
    if (o.page !== undefined || o.pageSize !== undefined) {
      throw new InputError('--page / --page-size 需要同时指定 --group（不带 --group 时只显示摘要和最紧急的任务，用 --limit 调数量）');
    }
    return o.limit === undefined ? {} : { limit: parseIntInRange(o.limit, '--limit', 1, MAX_URGENT_LIMIT) };
  }
  if (o.limit !== undefined) {
    throw new InputError('--limit 只用于不带 --group 的摘要视图；分组视图请用 --page / --page-size');
  }
  return {
    group: requireOneOf(o.group.trim().toLowerCase(), TASK_GROUPS, '--group'),
    pageNum: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
  };
}

export function buildProductsParams(o: { scope?: string }): Record<string, string> {
  return o.scope === undefined ? {} : { scope: requireOneOf(o.scope.trim().toLowerCase(), PRODUCT_SCOPES, '--scope') };
}
