import { ApiDate, DASH, dash, fmtDate, renderTable } from '../../utils/cliHelpers';
import { extractRecords, extractTotal } from '../../utils/extractRecords';
import { IdeaDecision, IdeaSolution, renderSolutions } from './renderSolutions';

export type { IdeaDecision, IdeaSolution };

export interface Idea {
  id: number;
  productId?: number;
  title?: string | null;
  description?: string | null;
  source?: string | null;
  status?: string | null;
  priority?: string | null;
  expectedValue?: string | null;
  requirementId?: number | null;
  releaseId?: number | null;
  rejectReason?: string | null;
  createdBy?: number | null;
  createdAt?: ApiDate;
  updatedAt?: ApiDate;
}

export interface IdeaDetail {
  idea: Idea;
  solutions?: IdeaSolution[] | null;
  decision?: IdeaDecision | null;
  tags?: string[] | null;
}

export function renderIdeaList(result: unknown, pageNum: number, pageSize: number): string {
  const records = extractRecords<Idea>(result);
  if (!records.length) return '没有符合条件的 Idea。';

  const rows = [['ID', '状态', '优先级', '来源', '需求', '标题', '创建时间']].concat(
    records.map((i) => [
      String(i.id), dash(i.status), dash(i.priority), dash(i.source),
      i.requirementId ? `#${i.requirementId}` : DASH, dash(i.title), fmtDate(i.createdAt),
    ])
  );
  const total = extractTotal(result, records);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `${renderTable(rows, { 5: { truncate: 40 } })}\n共 ${total} 条，第 ${pageNum}/${pages} 页`;
}

export function renderIdeaDetail(detail: IdeaDetail): string {
  const i = detail.idea;
  const lines = [
    `Idea #${i.id}  ${dash(i.title)}`,
    '─'.repeat(60),
    `状态:     ${dash(i.status)}    优先级: ${dash(i.priority)}    来源: ${dash(i.source)}`,
    `产品:     ${dash(i.productId)}    发布: ${i.releaseId ? `#${i.releaseId}` : DASH}    标签: ${detail.tags?.length ? detail.tags.join(', ') : DASH}`,
    `预期价值: ${dash(i.expectedValue)}`,
  ];
  if (i.status === 'rejected' || i.rejectReason) lines.push(`驳回原因: ${dash(i.rejectReason)}`);
  if (i.requirementId) {
    lines.push(`关联需求: #${i.requirementId}（需求收件箱，good7ob req show ${i.requirementId}）`);
  } else if (i.status === 'approved') {
    lines.push(`关联需求: ${dash(i.requirementId)}`);
  }
  lines.push(`创建:     ${fmtDate(i.createdAt)} by ${dash(i.createdBy)}    更新: ${fmtDate(i.updatedAt)}`);
  if (i.description) lines.push('', '描述:', i.description);
  lines.push('', ...renderSolutions(detail.solutions ?? [], detail.decision));
  return lines.join('\n');
}
