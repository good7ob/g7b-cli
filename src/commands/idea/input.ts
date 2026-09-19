/**
 * CLI-boundary validation for `idea` commands. Limits mirror the backend DTOs
 * (IdeaCreateDto / IdeaUpdateDto / IdeaSolution*Dto) so a bad value is rejected
 * here with a clear message instead of as a 1001 round-trip.
 */

import {
  ErrorCodeMap,
  InputError,
  checkMaxLength,
  parseId,
  parseIntInRange,
  requireOneOf,
  requireText,
} from '../../utils/cliHelpers';

export const SOURCES = [
  'customer', 'feedback', 'pm', 'dev', 'ai', 'ops', 'bug', 'competitor', 'market', 'management',
] as const;
export const PRIORITIES = ['low', 'medium', 'high'] as const;
export const STATUSES = ['draft', 'evaluating', 'approved', 'rejected', 'archived'] as const;
export const TRANSITIONS = ['evaluating', 'archived'] as const;

export const MAX_TITLE = 200;
export const MAX_EXPECTED_VALUE = 500;
export const MAX_SOLUTION_NAME = 200;
export const MAX_SOLUTION_NOTE = 500;
export const MAX_REASON = 1000;
export const MAX_PAGE_SIZE = 100;

export const IDEA_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数值不合法',
  1002: 'Idea / 方案不存在（或已删除）',
  1007: '当前状态不允许该操作（已批准/已归档的 Idea 不可修改；选定方案要求 Idea 处于 evaluating 且尚未生成需求）',
  1009: '并发冲突（其他人刚刚修改了它），请重试',
  2000: '无权访问：你不是该 Idea 所属产品的组织成员',
};

/** Raw commander options -> validated request pieces. All throw before any HTTP call. */

export function resolveProductId(raw?: string): number {
  const value = raw ?? process.env.GOOD7OB_PRODUCT_ID;
  if (value === undefined) {
    throw new InputError('缺少产品 ID。用 --product <id> 指定，或设置环境变量 GOOD7OB_PRODUCT_ID。');
  }
  return parseId(value, '--product');
}

export function buildListParams(o: {
  product?: string; status?: string; keyword?: string; page?: string; pageSize?: string;
}): Record<string, string | number> {
  const params: Record<string, string | number> = {
    productId: resolveProductId(o.product),
    pageNum: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
  };
  if (o.status !== undefined) params.status = requireOneOf(o.status, STATUSES, '--status');
  if (o.keyword) params.keyword = o.keyword;
  return params;
}

interface IdeaFlags {
  title?: string; description?: string; source?: string; priority?: string; expectedValue?: string;
}

function applyOptionalIdeaFields(body: Record<string, string>, o: IdeaFlags): void {
  if (o.source !== undefined) body.source = requireOneOf(o.source, SOURCES, '--source');
  if (o.priority !== undefined) body.priority = requireOneOf(o.priority, PRIORITIES, '--priority');
  if (o.description !== undefined) body.description = o.description;
  if (o.expectedValue !== undefined) body.expectedValue = checkMaxLength(o.expectedValue, MAX_EXPECTED_VALUE, '--expected-value');
}

export function buildCreateBody(o: IdeaFlags & { product?: string }): Record<string, string | number> {
  const body: Record<string, string | number> = {
    productId: resolveProductId(o.product),
    title: requireText(o.title, MAX_TITLE, '--title'),
    source: requireOneOf(o.source ?? '', SOURCES, '--source'),
  };
  applyOptionalIdeaFields(body as Record<string, string>, o);
  return body;
}

/** Omitted flag = field unchanged (backend contract), so only send what was given. */
export function buildUpdateBody(o: IdeaFlags): Record<string, string> {
  const body: Record<string, string> = {};
  if (o.title !== undefined) body.title = requireText(o.title, MAX_TITLE, '--title');
  applyOptionalIdeaFields(body, o);
  if (Object.keys(body).length === 0) {
    throw new InputError('没有要修改的字段：至少指定 --title / --description / --source / --priority / --expected-value 之一');
  }
  return body;
}

interface SolutionFlags {
  name?: string; description?: string; costNote?: string; cycleNote?: string; effectNote?: string;
}

function applySolutionNotes(body: Record<string, string>, o: SolutionFlags): void {
  if (o.description !== undefined) body.description = o.description;
  if (o.costNote !== undefined) body.costNote = checkMaxLength(o.costNote, MAX_SOLUTION_NOTE, '--cost-note');
  if (o.cycleNote !== undefined) body.cycleNote = checkMaxLength(o.cycleNote, MAX_SOLUTION_NOTE, '--cycle-note');
  if (o.effectNote !== undefined) body.expectedEffectNote = checkMaxLength(o.effectNote, MAX_SOLUTION_NOTE, '--effect-note');
}

export function buildSolutionCreateBody(o: SolutionFlags): Record<string, string> {
  const body: Record<string, string> = { name: requireText(o.name, MAX_SOLUTION_NAME, '--name') };
  applySolutionNotes(body, o);
  return body;
}

export function buildSolutionUpdateBody(o: SolutionFlags): Record<string, string> {
  const body: Record<string, string> = {};
  if (o.name !== undefined) body.name = requireText(o.name, MAX_SOLUTION_NAME, '--name');
  applySolutionNotes(body, o);
  if (Object.keys(body).length === 0) {
    throw new InputError('没有要修改的字段：至少指定 --name / --description / --cost-note / --cycle-note / --effect-note 之一');
  }
  return body;
}

export function buildReasonBody(field: 'reason' | 'decisionReason', raw: string | undefined): Record<string, string> {
  return { [field]: requireText(raw, MAX_REASON, '--reason') };
}
