import { ApiDate, DASH, dash, fmtDateTime, fmtNum, renderTable } from '../../utils/cliHelpers';

/** Renderers for `workspace ai-team` / `ai-team log` and the overview's AI team block (api-0089 §7). */

export interface TaskRef {
  id?: number | null;
  name?: string | null;
  status?: string | null;
  blockedReason?: string | null;
}

/** Lifetime numbers. `cost` is always null on the backend (no token price source) — it is not shown. */
export interface AiStats {
  tasksCompleted?: number | null;
  successRate?: number | null;
  workingHours?: number | null;
  tokens?: number | null;
  cost?: number | null;
  score?: number | null;
  reworkRejected?: number | null;
  blockedEvents?: number | null;
}

export interface AiEmployee {
  id?: number | null;
  orgId?: number | null;
  orgName?: string | null;
  name?: string | null;
  agentKind?: string | null;
  state?: string | null;
  stateReason?: string | null;
  currentTasks?: TaskRef[] | null;
  /** Absent in the overview's `top` list. */
  queueLength?: number | null;
  stats?: AiStats | null;
}

export type AiTeamCounts = Record<string, number | null>;

export interface AiTeam {
  total?: number | null;
  counts?: AiTeamCounts | null;
  employees?: AiEmployee[] | null;
}

export interface AiTeamSummary {
  total?: number | null;
  working?: number | null;
  waiting?: number | null;
  error?: number | null;
  idle?: number | null;
  top?: AiEmployee[] | null;
}

export interface WorkLogEntry {
  time?: ApiDate;
  type?: string | null;
  taskId?: number | null;
  title?: string | null;
  detail?: string | null;
}

export interface WorkLog {
  employeeId?: number | null;
  from?: ApiDate;
  to?: ApiDate;
  pageNum?: number | null;
  pageSize?: number | null;
  total?: number | null;
  items?: WorkLogEntry[] | null;
}

const STATE_LABELS: Record<string, string> = { working: '工作中', waiting: '等待中', error: '异常', idle: '空闲' };
const REASON_LABELS: Record<string, string> = { blocked_tasks: '有阻塞任务', last_record_failed: '最近工作记录失败' };
const LOG_TYPES: Record<string, string> = { WORK_RECORD: '工作记录', STATE_CHANGE: '状态变更', COMMENT: '评论', REVIEW: '评审' };

const stateCell = (e: AiEmployee) => {
  const label = STATE_LABELS[e.state ?? ''] ?? dash(e.state);
  return e.stateReason ? `${label}（${REASON_LABELS[e.stateReason] ?? e.stateReason}）` : label;
};

function tasksCell(e: AiEmployee): string {
  const tasks = e.currentTasks ?? [];
  if (!tasks.length) return DASH;
  const first = tasks[0];
  const reason = first.blockedReason ? `/${first.blockedReason}` : '';
  return `#${dash(first.id)} ${dash(first.name)} [${dash(first.status)}${reason}]${tasks.length > 1 ? `  +${tasks.length - 1}` : ''}`;
}

export function countsLine(c: AiTeamCounts | AiTeamSummary | null | undefined): string {
  const pick = (k: string) => dash((c as Record<string, unknown> | null | undefined)?.[k]);
  return Object.keys(STATE_LABELS).map((k) => `${STATE_LABELS[k]} ${pick(k)}`).join('  ');
}

const percent = (v?: number | null) => (v == null ? DASH : fmtNum(v * 100, '%', 1));

export function renderAiTeam(team: AiTeam, status?: string): string {
  const employees = team.employees ?? [];
  const filter = status && status !== 'all' ? `（筛选: ${status}）` : '';
  const head = [`我的 AI 团队: ${dash(team.total)}${filter}`, `${countsLine(team.counts)}（各状态人数不受筛选影响）`];
  if (!employees.length) return [...head, '', '没有 AI 员工。'].join('\n');
  const rows = [['ID', '名称', '组织', '状态', '当前任务', '排队', '完成', '成功率', '工时(h)', 'Tokens', '说明充分度', '被驳回', '阻塞']].concat(
    employees.map((e) => [
      dash(e.id), dash(e.name), dash(e.orgName), stateCell(e), tasksCell(e), dash(e.queueLength),
      dash(e.stats?.tasksCompleted), percent(e.stats?.successRate), fmtNum(e.stats?.workingHours), dash(e.stats?.tokens),
      fmtNum(e.stats?.score), dash(e.stats?.reworkRejected), dash(e.stats?.blockedEvents),
    ])
  );
  return [
    ...head, '', renderTable(rows, { 1: { truncate: 20 }, 2: { truncate: 20 }, 4: { truncate: 40 } }), '',
    '统计为累计值，只含执行者登记为 emp:<员工id> 的任务；成功率 = 完成 / (完成 + 被驳回 + 阻塞)；说明充分度 = 交给员工的任务说明是否充分（不是员工质量评分）；成本暂无来源，不显示。',
  ].join('\n');
}

export function renderWorkLog(log: WorkLog): string {
  const items = log.items ?? [];
  const size = log.pageSize ?? 0;
  const pages = size > 0 && typeof log.total === 'number' ? Math.max(1, Math.ceil(log.total / size)) : null;
  const head = `AI 员工 #${dash(log.employeeId)} 工作日志    ${fmtDateTime(log.from)} → ${fmtDateTime(log.to)}    共 ${dash(log.total)} 条，第 ${dash(log.pageNum)}/${dash(pages)} 页`;
  if (!items.length) return `${head}\n\n该时间范围内没有记录。`;
  const rows = [['时间', '类型', '任务', '详情']].concat(
    items.map((i) => [
      fmtDateTime(i.time), LOG_TYPES[i.type ?? ''] ?? dash(i.type),
      i.taskId ? `#${i.taskId} ${dash(i.title)}` : dash(i.title), dash(i.detail),
    ])
  );
  return `${head}\n\n${renderTable(rows, { 2: { truncate: 30 }, 3: { truncate: 80 } })}`;
}

/** The overview block: counters + the AI employees needing attention first (`top`). */
export function renderAiTeamSummary(s: AiTeamSummary): string {
  const top = s.top ?? [];
  const lines = [`共 ${dash(s.total)}    ${countsLine(s)}`];
  if (top.length) {
    lines.push(renderTable(
      [['名称', '组织', '状态', '当前任务']].concat(top.map((e) => [dash(e.name), dash(e.orgName), stateCell(e), tasksCell(e)])),
      { 3: { truncate: 40 } }
    ));
  }
  return lines.join('\n');
}
