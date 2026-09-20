/**
 * CLI-boundary validation for `approval` commands. Mirrors ApprovalService: status and
 * targetType are validated, page size is 1..100, a rejection needs a non-blank comment.
 */

import {
  ErrorCodeMap,
  InputError,
  normalizeTypeCode,
  parseId,
  parseIntInRange,
  requireOneOf,
} from '../../utils/cliHelpers';

export const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const MAX_PAGE_SIZE = 100;

export const APPROVAL_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数（驳回必须填写 --comment）',
  1001: '参数值不合法',
  1002: '审批不存在',
  1009: '该审批已被处理（批准/驳回/撤销），无法再次操作 —— 请用 approval get 查看结果',
  2000: '无权操作：仅组织 owner/admin 可批准或驳回；申请人不能批准/驳回自己的申请（除非组织里没有其他审批人；自己的申请请用 cancel）；非组织成员不可见',
};

export function buildListParams(o: {
  status?: string; targetType?: string; targetId?: string; product?: string; mine?: boolean;
  page?: string; pageSize?: string;
}): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {
    pageNum: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
  };
  if (o.status !== undefined) params.status = requireOneOf(o.status, STATUSES, '--status');
  if (o.mine && params.status !== undefined && params.status !== 'pending') {
    // The backend forces status=pending for mine=true and silently drops --status.
    throw new InputError('--mine 只返回待我决定的 pending 申请，不能与 --status ' + params.status + ' 同时使用');
  }
  if (o.targetType !== undefined) params.targetType = normalizeTypeCode(o.targetType, '--target-type');
  if (o.targetId !== undefined) params.targetId = parseId(o.targetId, '--target-id');
  if (o.product !== undefined) params.productId = parseId(o.product, '--product');
  if (o.mine) params.mine = true;
  return params;
}

/** Approve: comment optional. Reject: comment required and non-blank. */
export function buildDecisionBody(comment: string | undefined, required: boolean): Record<string, string> {
  if (required && (comment === undefined || !comment.trim())) {
    throw new InputError('--comment 不能为空（驳回必须说明原因）');
  }
  return comment === undefined ? {} : { comment };
}
