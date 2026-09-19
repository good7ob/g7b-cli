import { ApiDate, DASH, dash, fmtDateTime, renderTable } from '../../../utils/cliHelpers';
import { block } from './kpi';

/** Renderers for `pm health report generate|list|get` (api-0090 §13). */

export interface ReportItem {
  id: number;
  productId?: number | null;
  releaseId?: number | null;
  periodType?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  title?: string | null;
  aiPolished?: boolean | null;
  aiWarning?: string | null;
  createdBy?: number | null;
  createdAt?: ApiDate;
}

/** Generate and detail share this shape; `structured` holds the sections (shown with --json). */
export interface Report extends ReportItem {
  weightBasis?: string | null;
  contentMarkdown?: string | null;
  structured?: Record<string, unknown> | null;
  aiModel?: string | null;
}

export interface ReportPage {
  records?: ReportItem[] | null;
  total?: number | null;
  current?: number | null;
  size?: number | null;
  pages?: number | null;
}

const period = (r: ReportItem) => (r.periodFrom || r.periodTo ? `${dash(r.periodFrom)} ~ ${dash(r.periodTo)}` : DASH);

/** Meta block shared by generate and get; the AI part is always spelled out. */
export function renderReportMeta(r: Report): string {
  const lines = [
    block([
      ['报告', `#${r.id}  ${dash(r.title)}`],
      ['类型 / 期间', `${dash(r.periodType)}  ${period(r)}`],
      ['范围', r.releaseId ? `Release #${r.releaseId}` : '产品级'],
      ['生成', `${fmtDateTime(r.createdAt)} by ${dash(r.createdBy)}`],
    ]),
  ];
  if (r.aiPolished) lines.push(`含 AI 生成的摘要章节（模型 ${dash(r.aiModel)}；AI 生成，需人工确认，其余章节的数字来自确定性计算）`);
  if (r.aiWarning) lines.push(`⚠ AI 摘要未生成：${r.aiWarning}（报告本身已完整生成并保存）`);
  return lines.join('\n');
}

export function renderReport(r: Report, verb?: string): string {
  const body = r.contentMarkdown ? r.contentMarkdown : '（报告没有正文）';
  return [verb ? `✓ 管理报告已${verb}` : '', renderReportMeta(r), '─'.repeat(60), body].filter((part, i) => i > 0 || part).join('\n');
}

export function renderReportList(page: ReportPage): string {
  const records = page.records ?? [];
  if (!records.length) return '没有管理报告。';
  const rows = [['ID', '类型', '期间', 'Release', 'AI', '生成时间', '标题']].concat(
    records.map((r) => [String(r.id), dash(r.periodType), period(r), dash(r.releaseId), r.aiPolished ? '是' : '否', fmtDateTime(r.createdAt), dash(r.title)])
  );
  return `${renderTable(rows, { 6: { truncate: 40 } })}\n共 ${dash(page.total)} 条，第 ${dash(page.current)}/${dash(page.pages)} 页；全文: good7ob pm health report get <id> [--out file.md]`;
}
