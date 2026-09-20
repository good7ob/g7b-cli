/**
 * CLI-boundary validation for `idea change-set` (ChangeSetCreateDto / ChangeSetUpdateDto /
 * ChangeSetItemDto / ChangeSetQueryDto / ChangeSetApplyDto). Limits mirror ChangeSetItemFields.
 */

import {
  ErrorCodeMap, InputError, checkMaxLength, parseId, parseIntInRange, requireOneOf, requireText, resolveProductId,
} from '../../utils/cliHelpers';
import { MAX_PAGE_SIZE } from './input';

export const CHANGE_SET_STATUSES = [
  'draft', 'impact_analyzed', 'pending_approval', 'approved', 'applied', 'rejected', 'cancelled',
] as const;
export const OBJECT_TYPES = ['PRD', 'FP', 'RP', 'UI', 'API', 'DB', 'ARCH', 'TEST_CASE', 'TASK', 'OTHER'] as const;
export const CHANGE_KINDS = ['add', 'update', 'remove'] as const;

export const MAX_CS_TITLE = 200;
export const MAX_CS_SUMMARY = 2000;
export const MAX_ITEM_DESCRIPTION = 1000;
export const MAX_OBJECT_REF = 300;

export const CHANGE_SET_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数值不合法（枚举 / 长度 / solutionId 不属于该 Idea / moduleId 不属于该产品）',
  1002: '变更集 / 条目 / Idea 不存在（或已删除）',
  1006: '数据已存在：同一变更集内该对象已有条目，或已有待处理的审批',
  1007: '当前状态不允许该操作（创建要求 Idea 为 approved/planning；改条目仅 draft/impact_analyzed；提交要求 impact_analyzed 且至少 1 个已确认条目；Apply 要求 approved 且未 Apply）',
  1009: '并发冲突（状态刚被他人改变），请重试',
  2000: '无权访问：你不是该产品的组织成员（Apply 另要求 owner/admin 或创建人）',
};

type Body = Record<string, unknown>;

export function buildCreateBody(ideaId: number, o: { title?: string; solution?: string; summary?: string }): Body {
  const body: Body = { ideaId, title: requireText(o.title, MAX_CS_TITLE, '--title') };
  if (o.solution !== undefined) body.solutionId = parseId(o.solution, '--solution');
  if (o.summary !== undefined) body.summary = checkMaxLength(o.summary, MAX_CS_SUMMARY, '--summary');
  return body;
}

/** Omitted flag = unchanged (backend contract), so only send what was given. */
export function buildUpdateBody(o: { title?: string; summary?: string }): Body {
  const body: Body = {};
  if (o.title !== undefined) body.title = requireText(o.title, MAX_CS_TITLE, '--title');
  if (o.summary !== undefined) body.summary = checkMaxLength(o.summary, MAX_CS_SUMMARY, '--summary');
  if (Object.keys(body).length === 0) throw new InputError('没有要修改的字段：至少指定 --title / --summary 之一');
  return body;
}

/** The backend requires ideaId or productId; the CLI takes exactly one (product may come from GOOD7OB_PRODUCT_ID). */
export function buildListParams(o: {
  idea?: string; product?: string; status?: string; page?: string; pageSize?: string;
}): Record<string, string | number> {
  if (o.idea !== undefined && o.product !== undefined) throw new InputError('--idea 与 --product 只能二选一');
  const scope = o.idea !== undefined ? { ideaId: parseId(o.idea, '--idea') } : { productId: resolveProductId(o.product) };
  const params: Record<string, string | number> = {
    ...scope,
    pageNum: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
  };
  if (o.status !== undefined) params.status = requireOneOf(o.status, CHANGE_SET_STATUSES, '--status');
  return params;
}

export interface ItemFlags {
  type?: string; kind?: string; description?: string; objectId?: string; objectRef?: string;
}

/** Type is case-insensitive (the backend upper-cases it), kind likewise lower-cases. */
function applyItemFields(body: Body, o: ItemFlags): void {
  if (o.type !== undefined) body.objectType = requireOneOf(o.type.trim().toUpperCase(), OBJECT_TYPES, '--type');
  if (o.kind !== undefined) body.changeKind = requireOneOf(o.kind.trim().toLowerCase(), CHANGE_KINDS, '--kind');
  if (o.description !== undefined) body.description = requireText(o.description, MAX_ITEM_DESCRIPTION, '--description');
  if (o.objectId !== undefined) body.objectId = parseId(o.objectId, '--object-id');
  if (o.objectRef !== undefined) body.objectRef = requireText(o.objectRef, MAX_OBJECT_REF, '--object-ref');
}

/** type / kind / description are mandatory and at least one of object id / ref must locate the object. */
export function buildItemAddBody(o: ItemFlags): Body {
  const missing = (['type', 'kind', 'description'] as const).filter((k) => o[k] === undefined);
  if (missing.length) throw new InputError(`缺少必填参数: ${missing.map((k) => `--${k}`).join(' / ')}`);
  if (o.objectId === undefined && o.objectRef === undefined) {
    throw new InputError('--object-id 与 --object-ref 至少提供一个（同时给出也可以）');
  }
  const body: Body = {};
  applyItemFields(body, o);
  return body;
}

export function buildItemUpdateBody(o: ItemFlags): Body {
  const body: Body = {};
  applyItemFields(body, o);
  if (Object.keys(body).length === 0) {
    throw new InputError('没有要修改的字段：至少指定 --type / --kind / --description / --object-id / --object-ref 之一');
  }
  return body;
}

export function buildApplyBody(o: { module?: string }): Body {
  return o.module === undefined ? {} : { moduleId: parseId(o.module, '--module') };
}
