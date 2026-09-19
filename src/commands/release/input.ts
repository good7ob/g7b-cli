/**
 * CLI-boundary validation for `release` commands. Limits mirror ReleaseService /
 * ReleaseTaskService (name <= 200, version <= 50, 1..200 task ids per call) so a bad
 * value is rejected here with a clear message instead of as a 1001 round-trip.
 */

import {
  ErrorCodeMap,
  InputError,
  parseDate,
  parseIdList,
  requireOneOf,
  requireText,
  resolveProductId,
} from '../../utils/cliHelpers';

export const STATUSES = ['planned', 'in_progress', 'awaiting_approval', 'released', 'cancelled'] as const;

export const MAX_NAME = 200;
export const MAX_VERSION = 50;
export const MAX_TASK_IDS = 200;

export const RELEASE_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数值不合法（日期倒置 / 任务不存在或不属于该产品 / 任务数超限等）',
  1002: 'Release / 产品不存在（或已删除）',
  1006: '冲突：版本号已存在，或任务已属于另一个未取消的 Release，或该 Release 已有待处理审批',
  1007: '当前状态不允许该操作（planned→start→in_progress→request-approval→awaiting_approval；仅 planned/in_progress 可编辑/取消/调整任务，仅 planned/cancelled 可删除）',
  2000: '无权访问：你不是该产品所属组织的成员',
};

interface ReleaseFlags {
  name?: string; version?: string; description?: string; start?: string; end?: string;
}

/** Only the fields that were given: on update an omitted field means "unchanged". */
function applyReleaseFields(body: Record<string, string>, o: ReleaseFlags): void {
  if (o.name !== undefined) body.name = requireText(o.name, MAX_NAME, '--name');
  if (o.version !== undefined) body.version = requireText(o.version, MAX_VERSION, '--version');
  if (o.description !== undefined) body.description = o.description;
  if (o.start !== undefined) body.plannedStartDate = parseDate(o.start, '--start');
  if (o.end !== undefined) body.plannedEndDate = parseDate(o.end, '--end');
  if (body.plannedStartDate && body.plannedEndDate && body.plannedEndDate < body.plannedStartDate) {
    throw new InputError(`--end (${body.plannedEndDate}) 不能早于 --start (${body.plannedStartDate})`);
  }
}

export function buildListParams(o: { product?: string; status?: string }): Record<string, string | number> {
  const params: Record<string, string | number> = { productId: resolveProductId(o.product) };
  if (o.status !== undefined) params.status = requireOneOf(o.status, STATUSES, '--status');
  return params;
}

export function buildCreateBody(o: ReleaseFlags & { product?: string }): Record<string, string | number> {
  const body: Record<string, string | number> = {
    productId: resolveProductId(o.product),
    name: requireText(o.name, MAX_NAME, '--name'),
    version: requireText(o.version, MAX_VERSION, '--version'),
  };
  applyReleaseFields(body as Record<string, string>, o);
  return body;
}

export function buildUpdateBody(o: ReleaseFlags): Record<string, string> {
  const body: Record<string, string> = {};
  applyReleaseFields(body, o);
  if (Object.keys(body).length === 0) {
    throw new InputError('没有要修改的字段：至少指定 --name / --version / --description / --start / --end 之一');
  }
  return body;
}

export function buildRequestApprovalBody(description?: string): Record<string, string> {
  return description === undefined ? {} : { description };
}

export function buildTaskIdsBody(raw: string | undefined): { taskIds: number[] } {
  return { taskIds: parseIdList(raw, '--task-ids', MAX_TASK_IDS) };
}
