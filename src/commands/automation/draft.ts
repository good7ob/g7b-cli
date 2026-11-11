/**
 * `automation draft` (prd-0187 FP-6, api-0187 §1): task drafts an AI employee proposed inside a window-loop run when
 * the self-build guard would not create the task. List is open to org members; approve / reject are human-only (the
 * backend answers an AI key with 2703, so nothing is pre-judged here).
 */
import { ErrorCodeMap, ApiDate, dash, fmtDateTime, parseId, parseIntInRange, renderTable, requireOneOf } from '../../utils/cliHelpers';
import { extractRecords } from '../../utils/extractRecords';

export const DRAFT_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;

export const DRAFT_ERROR_CODES: ErrorCodeMap = {
  1001: '参数不合法',
  1002: '草案不存在（或不属于该组织）',
  2000: '无权处理该草案：只有该自动化的启用人或组织 owner/admin（且有工作流席位）可批准 / 驳回',
  2004: '你不是该组织的活跃成员',
  2702: '草案当前状态不允许该操作（已驳回 / 已到期 / 已批准的不能再改）',
  2703: 'AI 员工 Key 不能处理草案：批准 / 驳回只能用人类 Key（个人 Key）',
};

export interface TaskDraft {
  id: number; automationId?: number; runId?: number | null; stepId?: number | null; employeeId?: number | null;
  projectId?: number | null; title?: string; priority?: string | null; reason?: string; status?: string;
  expiresAt?: ApiDate; approvedTaskId?: number | null; decidedBy?: number | null; decidedAt?: ApiDate;
  functionPointId?: number | null; rulePointId?: number | null; parentTaskId?: number | null;
}

export function buildDraftListParams(o: {
  automationId?: string; runId?: string; status?: string; limit?: string;
}): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (o.automationId !== undefined) params.automationId = parseId(o.automationId, '--automation-id');
  if (o.runId !== undefined) params.runId = parseId(o.runId, '--run-id');
  if (o.status !== undefined) params.status = requireOneOf(o.status.trim().toLowerCase(), DRAFT_STATUSES, '--status');
  if (o.limit !== undefined) params.limit = parseIntInRange(o.limit, '--limit', 1, 200);
  return params;
}

export function renderDraftList(result: unknown): string {
  const rows = extractRecords<TaskDraft>(result);
  if (!rows.length) return '没有符合条件的任务草案。';
  const table = [['ID', '状态', '原因', '标题', '优先级', '自动化', '运行', '过期时间', '批准后任务']].concat(
    rows.map((d) => [
      String(d.id), dash(d.status), dash(d.reason), dash(d.title), dash(d.priority), dash(d.automationId),
      d.runId ? `#${d.runId}` : '—', fmtDateTime(d.expiresAt), d.approvedTaskId ? `#${d.approvedTaskId}` : '—',
    ])
  );
  const pending = rows.filter((d) => d.status === 'pending').length;
  return `${renderTable(table, { 3: { truncate: 40 } })}\n共 ${rows.length} 条（待处理 ${pending}）`;
}

export function renderDraftDecision(d: TaskDraft | undefined, id: number, action: 'approve' | 'reject'): string {
  if (action === 'reject') return `✓ 草案 #${d?.id ?? id} 已驳回（${dash(d?.status)}），没有创建任务`;
  return `✓ 草案 #${d?.id ?? id} 已批准（${dash(d?.status)}）` +
    (d?.approvedTaskId ? `，已创建任务 #${d.approvedTaskId}（pending_agent）` : '');
}
