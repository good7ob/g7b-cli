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
  resolveProductId,
} from '../../utils/cliHelpers';

export const SOURCES = [
  'customer', 'feedback', 'pm', 'dev', 'ai', 'ops', 'bug', 'competitor', 'market', 'management',
] as const;
export const PRIORITIES = ['low', 'medium', 'high'] as const;
export const STATUSES = [
  'draft', 'evaluating', 'approved', 'rejected', 'archived', 'planning', 'developing', 'released', 'validated',
] as const;
/** approved / rejected are only reachable through `idea select` / `idea reject`. */
export const TRANSITIONS = ['evaluating', 'archived', 'planning', 'developing', 'released', 'validated'] as const;

export const MAX_TITLE = 200;
export const MAX_EXPECTED_VALUE = 500;
export const MAX_REASON = 1000;
export const MAX_PAGE_SIZE = 100;
export const MAX_TAG_LENGTH = 30;

export const IDEA_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数值不合法',
  1002: 'Idea / 方案不存在（或已删除）',
  1006: '数据已存在：关联重复，或该 Idea 已有待审批的决策（审批完成前不能再次选定 / 发起审批 / 合并）',
  1007: '当前状态不允许该操作（非法状态流转、字段已锁定、附件已达 20 个上限、合并 / 恢复条件不满足；选定方案要求 Idea 处于 evaluating 且尚未生成需求）',
  1008: '缺少 id',
  1009: '并发冲突（其他人刚刚修改了它），请重试',
  2000: '无权访问：你不是该 Idea 所属产品的组织成员',
};

/** Raw commander options -> validated request pieces. All throw before any HTTP call. */

export function buildListParams(o: {
  product?: string; status?: string; keyword?: string; tag?: string; release?: string; page?: string; pageSize?: string;
}): Record<string, string | number> {
  const params: Record<string, string | number> = {
    productId: resolveProductId(o.product),
    pageNum: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
  };
  if (o.status !== undefined) params.status = requireOneOf(o.status, STATUSES, '--status');
  if (o.keyword) params.keyword = o.keyword;
  if (o.tag !== undefined) params.tag = requireText(o.tag, MAX_TAG_LENGTH, '--tag');
  if (o.release !== undefined) params.releaseId = parseId(o.release, '--release');
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
export function buildUpdateBody(o: IdeaFlags & { release?: string; clearRelease?: boolean }): Record<string, string | number | boolean> {
  const body: Record<string, string | number | boolean> = {};
  if (o.title !== undefined) body.title = requireText(o.title, MAX_TITLE, '--title');
  applyOptionalIdeaFields(body as Record<string, string>, o);
  if (o.release !== undefined && o.clearRelease) throw new InputError('--release 与 --clear-release 不能同时使用');
  if (o.release !== undefined) body.releaseId = parseId(o.release, '--release');
  if (o.clearRelease) body.clearRelease = true;
  if (Object.keys(body).length === 0) {
    throw new InputError('没有要修改的字段：至少指定 --title / --description / --source / --priority / --expected-value / --release / --clear-release 之一');
  }
  return body;
}

/** approved / rejected get a pointer to the command that does reach them. */
export function parseTransition(raw: string): (typeof TRANSITIONS)[number] {
  try {
    return requireOneOf(raw, TRANSITIONS, 'toStatus');
  } catch (error) {
    if (raw === 'approved' || raw === 'rejected') {
      throw new InputError(`${(error as Error).message}；approved 只能用 idea select，rejected 只能用 idea reject`);
    }
    throw error;
  }
}

export function buildReasonBody(field: 'reason' | 'decisionReason', raw: string | undefined): Record<string, string> {
  return { [field]: requireText(raw, MAX_REASON, '--reason') };
}

/** `<solutionId>:<text>` (split on the first colon) -> {solutionId, reason}. */
export function parseRejectedReason(raw: string): { solutionId: number; reason: string } {
  const at = raw.indexOf(':');
  if (at < 0) throw new InputError(`--rejected-reason 格式为 <solutionId>:<原因>，收到: ${raw}`);
  return {
    solutionId: parseId(raw.slice(0, at), '--rejected-reason 的 solutionId'),
    reason: requireText(raw.slice(at + 1), MAX_REASON, '--rejected-reason 的原因'),
  };
}

/** Body of POST .../select. Without the new options it is exactly the MVP body {decisionReason}. */
export function buildSelectBody(
  solutionId: number,
  o: { reason?: string; rejectedReason?: string[]; requireApproval?: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...buildReasonBody('decisionReason', o.reason) };
  if (o.rejectedReason?.length) {
    const rejected = o.rejectedReason.map(parseRejectedReason);
    const ids = rejected.map((r) => r.solutionId);
    if (ids.includes(solutionId)) throw new InputError('--rejected-reason 不能包含被选定的方案本身');
    if (new Set(ids).size !== ids.length) throw new InputError('--rejected-reason 的 solutionId 不能重复');
    body.rejectedReasons = rejected;
  }
  if (o.requireApproval) body.requireApproval = true;
  return body;
}
