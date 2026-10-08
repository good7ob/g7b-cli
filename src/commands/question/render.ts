import { ApiDate, dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';

export interface QuestionOption { key: string; label: string; description?: string | null }

export interface Question {
  id: number;
  title?: string;
  description?: string | null;
  questionType?: string;
  options?: QuestionOption[] | null;
  source?: string;
  productId?: number | null;
  projectId?: number | null;
  taskId?: number | null;
  assigneeId?: number | null;
  needsApproval?: boolean;
  status?: string;
  answerOptionKey?: string | null;
  answerText?: string | null;
  answeredBy?: number | null;
  answeredAt?: ApiDate;
  approvalId?: number | null;
  createdBy?: number | null;
  createdAt?: ApiDate;
}

export interface AnswerResult {
  id: number;
  status?: string;
  answerOptionKey?: string | null;
  answerText?: string | null;
  taskResumed?: boolean;
  approvalId?: number | null;
}

export function renderQuestionList(result: { total?: number; items?: Question[] } | null, page: number, pageSize: number): string {
  const items = result?.items ?? [];
  if (!items.length) return '没有符合条件的 Question。';
  const rows = [['ID', '标题', '类型', '状态', '负责人', '任务', '创建时间']].concat(
    items.map((q) => [
      String(q.id), dash(q.title), dash(q.questionType), dash(q.status), dash(q.assigneeId), dash(q.taskId),
      fmtDateTime(q.createdAt),
    ])
  );
  const total = result?.total ?? items.length;
  return `${renderTable(rows, { 1: { width: 40, wrapWord: true } })}\n共 ${total} 条，第 ${page}/${Math.max(1, Math.ceil(total / pageSize))} 页`;
}

export function renderQuestionDetail(q: Question): string {
  const lines = [
    `Question #${q.id}  [${dash(q.status)}]  ${dash(q.title)}`,
    `类型: ${dash(q.questionType)}  来源: ${dash(q.source)}  需审批: ${q.needsApproval ? '是' : '否'}`,
    `产品: ${dash(q.productId)}  项目: ${dash(q.projectId)}  任务: ${dash(q.taskId)}  负责人: ${dash(q.assigneeId)}`,
  ];
  if (q.description) lines.push(`背景: ${q.description}`);
  (q.options ?? []).forEach((o) => lines.push(`  - ${o.key}: ${o.label}${o.description ? `（${o.description}）` : ''}`));
  if (q.answerOptionKey || q.answerText) {
    lines.push(`回答: ${[q.answerOptionKey, q.answerText].filter(Boolean).join(' / ')}  by ${dash(q.answeredBy)} @ ${fmtDateTime(q.answeredAt)}`);
  }
  if (q.approvalId) lines.push(`审批单: #${q.approvalId}（good7ob approval get ${q.approvalId}）`);
  lines.push(`创建: ${dash(q.createdBy)} @ ${fmtDateTime(q.createdAt)}`);
  return lines.join('\n');
}

export function renderAnswerOutcome(r: AnswerResult): string {
  if (r.status === 'pending_approval') {
    return `✓ 已回答 Question #${r.id}，转入待审批${r.approvalId ? `，审批单 #${r.approvalId}（good7ob approval get ${r.approvalId}）` : ''}`;
  }
  return `✓ 已回答 Question #${r.id}${r.taskResumed ? '，关联任务已从 PENDING_INFO 恢复执行' : ''}`;
}
