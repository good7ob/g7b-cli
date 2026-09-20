import { ApiDate, DASH, dash, fmtDate, renderTable } from '../../utils/cliHelpers';
import { extractRecords, extractTotal } from '../../utils/extractRecords';

export interface ChangeSet {
  id: number;
  ideaId?: number;
  productId?: number;
  solutionId?: number | null;
  code?: string | null;
  title?: string | null;
  summary?: string | null;
  status?: string | null;
  approvalId?: number | null;
  moduleId?: number | null;
  createdBy?: number | null;
  appliedBy?: number | null;
  appliedAt?: ApiDate;
  createdAt?: ApiDate;
  updatedAt?: ApiDate;
}

export interface ChangeSetItem {
  id: number;
  objectType?: string | null;
  objectId?: number | null;
  objectRef?: string | null;
  changeKind?: string | null;
  description?: string | null;
  source?: string | null;
  confidence?: string | null;
  isConfirmed?: boolean | null;
  taskId?: number | null;
}

export interface ChangeSetDetail {
  changeSet: ChangeSet;
  items?: ChangeSetItem[] | null;
}

export interface AnalyzeResult extends ChangeSetDetail {
  added?: { trace?: number | null; ai?: number | null } | null;
  warning?: string | null;
}

export interface ApplyResult {
  changeSet: ChangeSet;
  moduleId?: number | null;
  tasks?: Array<{ itemId: number; taskId: number }> | null;
  traceLinks?: number | null;
  ideaStatus?: string | null;
  summary?: string | null;
}

const wrap = (width: number) => ({ width, wrapWord: false });
const label = (cs: ChangeSet) => `${dash(cs.code)} (#${cs.id})`;

export function renderChangeSetList(result: unknown, pageNum: number, pageSize: number): string {
  const records = extractRecords<ChangeSet>(result);
  if (!records.length) return '没有符合条件的变更集。';
  const rows = [['ID', '编号', '状态', 'Idea', '审批单', '标题', '创建时间']].concat(
    records.map((c) => [
      String(c.id), dash(c.code), dash(c.status), c.ideaId ? `#${c.ideaId}` : DASH,
      c.approvalId ? `#${c.approvalId}` : DASH, dash(c.title), fmtDate(c.createdAt),
    ])
  );
  const total = extractTotal(result, records);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `${renderTable(rows, { 5: wrap(40) })}\n共 ${total} 条，第 ${pageNum}/${pages} 页`;
}

const target = (i: ChangeSetItem) => [i.objectId ? `#${i.objectId}` : '', i.objectRef ?? ''].filter(Boolean).join(' ') || DASH;
const confirmedMark = (i: ChangeSetItem) => (i.isConfirmed ? '✓ 已确认' : '✗ 待确认');
const origin = (i: ChangeSetItem) => `${dash(i.source)}${i.confidence ? `/${i.confidence}` : ''}`;

export function renderItems(items: ChangeSetItem[]): string {
  if (!items.length) return '条目: (暂无，用 idea change-set item add 添加，或 analyze 自动收集)';
  const rows = [['ID', '类型', '变更', '对象', '说明', '来源', '确认', '任务']].concat(
    items.map((i) => [
      String(i.id), dash(i.objectType), dash(i.changeKind), target(i), dash(i.description),
      origin(i), confirmedMark(i), i.taskId ? `#${i.taskId}` : DASH,
    ])
  );
  const confirmed = items.filter((i) => i.isConfirmed).length;
  return `条目 (${items.length}，已确认 ${confirmed})\n${renderTable(rows, { 3: wrap(30), 4: wrap(36) })}`;
}

export function renderChangeSetDetail(detail: ChangeSetDetail): string {
  const c = detail.changeSet;
  const lines = [
    `变更集 ${label(c)}  ${dash(c.title)}`,
    '─'.repeat(60),
    `状态:     ${dash(c.status)}    Idea: ${c.ideaId ? `#${c.ideaId}` : DASH}    方案: ${c.solutionId ? `#${c.solutionId}` : DASH}    产品: ${dash(c.productId)}`,
    `审批单:   ${c.approvalId ? `#${c.approvalId}（good7ob approval get ${c.approvalId}）` : DASH}    模块: ${c.moduleId ? `#${c.moduleId}` : DASH}`,
    `创建:     ${fmtDate(c.createdAt)} by ${dash(c.createdBy)}    更新: ${fmtDate(c.updatedAt)}`,
  ];
  if (c.appliedAt || c.appliedBy) lines.push(`Apply:    ${fmtDate(c.appliedAt)} by ${dash(c.appliedBy)}`);
  if (c.summary) lines.push('', '摘要:', c.summary);
  lines.push('', renderItems(detail.items ?? []));
  return lines.join('\n');
}

export function renderAnalyze(result: AnalyzeResult): string {
  const added = result.added;
  const lines = [
    `✓ 影响分析完成: ${label(result.changeSet)} → ${dash(result.changeSet.status)}；本次新增 追溯 ${dash(added?.trace)} 条 / AI 建议 ${dash(added?.ai)} 条（只追加，不删除已有条目）`,
  ];
  if (result.warning) lines.push(`⚠ 告警（分析仍成功；AI 建议可能已降级为仅追溯条目）: ${result.warning}`);
  lines.push('追溯 / AI 条目默认「待确认」，须逐条 idea change-set item confirm 后才会计入 submit / apply', '', renderItems(result.items ?? []));
  return lines.join('\n');
}

export function renderApply(result: ApplyResult): string {
  const tasks = result.tasks ?? [];
  const lines = [
    `✓ 已 Apply: ${label(result.changeSet)} → ${dash(result.changeSet.status)}；任务所属模块 #${dash(result.moduleId)}；Idea 状态: ${dash(result.ideaStatus)}`,
    `已创建任务 ${tasks.length} 个，新建追溯关系 ${dash(result.traceLinks)} 条`,
  ];
  if (tasks.length) {
    lines.push(renderTable([['条目', '任务']].concat(tasks.map((t) => [`#${t.itemId}`, `#${t.taskId}`]))));
  }
  if (result.summary) lines.push('', result.summary);
  lines.push('⚠ Apply 只生成任务与追溯关系，不会自动修改 PRD / UI / API / DB 等文档，请按条目自行更新文档。');
  return lines.join('\n');
}
