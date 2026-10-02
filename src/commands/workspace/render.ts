import { ApiDate, dash, DASH, fmtDateTime, renderTable } from '../../utils/cliHelpers';

export interface QueueItem {
  id?: number | null;
  status?: string | null;
  sourceType?: string | null;
  sourceId?: number | null;
  title?: string | null;
  actionType?: string | null;
  priority?: string | null;
  description?: string | null;
  dueAt?: ApiDate;
  snoozedUntil?: ApiDate;
  projectId?: number | null;
  projectName?: string | null;
  productId?: number | null;
  orgId?: number | null;
  createdAt?: ApiDate;
  /** B2: 0.. deterministic priority score (api-0089 §9); null / absent on older servers. */
  priorityScore?: number | null;
}

export interface MyQueue {
  total?: number | null;
  counts?: Record<string, number | null> | null;
  items?: QueueItem[] | null;
}

export interface QueueCounts {
  total?: number | null;
  counts?: Record<string, number | null> | null;
  snoozed?: number | null;
  dismissed?: number | null;
  done?: number | null;
}

export interface QueueActionResult {
  item?: QueueItem | null;
  action?: string | null;
  outcome?: string | null;
}

export const ACTION_LABELS: Record<string, string> = {
  PLAN_APPROVAL: '计划审批',
  COMPLETION_APPROVAL: '完成审批',
  INFO_REQUEST: '信息请求',
  BLOCKED: '已阻塞',
  PAUSED: '已暂停',
  SYSTEM_ALERT: '系统提醒',
  REQUIREMENT_TRIAGE: '需求分诊',
  APPROVAL: '审批申请',
  RISK_ALERT: '风险预警',
  BUG_FIX: '缺陷修复',
};

const STATUS_HEADINGS: Record<string, string> = {
  active: '待我处理', snoozed: '已稍后', dismissed: '已忽略', done: '已完成', all: '全部',
  new: '新待办', in_progress: '处理中', waiting: '等待中',
};

/** `计划审批 3  完成审批 0 …` — every action type, a count the backend did not send is —, never 0. */
export function renderCountsSummary(counts: Record<string, number | null> | null | undefined): string {
  return Object.keys(ACTION_LABELS)
    .map((k) => `${ACTION_LABELS[k]} ${dash(counts?.[k])}`)
    .join('  ');
}

/** Time cell: a live snooze wins (stored in UTC), otherwise the task deadline. */
const whenCell = (i: QueueItem) =>
  i.snoozedUntil ? `稍后至 ${fmtDateTime(i.snoozedUntil)} UTC` : fmtDateTime(i.dueAt);

export function renderQueue(queue: MyQueue, status?: string): string {
  const items = queue.items ?? [];
  const heading = STATUS_HEADINGS[status ?? 'active'] ?? status;
  const lines = [`${heading}: ${dash(queue.total)}`, renderCountsSummary(queue.counts)];

  if (!items.length) return [...lines, '', '队列为空。'].join('\n');

  // The priority score column only appears when the backend sent one (B2 and later).
  const scored = items.some((i) => i.priorityScore != null);
  const cells = (i: QueueItem): string[] => {
    const row = [
      dash(i.id), dash(i.status), dash(i.sourceType), dash(i.sourceId),
      ACTION_LABELS[i.actionType ?? ''] ?? dash(i.actionType), dash(i.priority),
      dash(i.projectName ?? i.projectId), dash(i.title), whenCell(i), fmtDateTime(i.createdAt),
    ];
    if (scored) row.splice(6, 0, dash(i.priorityScore));
    return row;
  };
  const header = ['ID', '状态', '类型', '来源ID', '动作', '优先级', '项目', '标题', '到期/稍后', '创建时间'];
  if (scored) header.splice(6, 0, '优先分');
  const shift = scored ? 1 : 0;
  lines.push('', renderTable([header].concat(items.map(cells)), { [6 + shift]: { truncate: 20 }, [7 + shift]: { truncate: 40 } }));
  if (typeof queue.total === 'number' && queue.total > items.length) {
    lines.push(`显示 ${items.length} / ${queue.total} 条（用 --limit 调大，最大 200）`);
  }
  return lines.join('\n');
}

/** `workspace queue counts`: active total + per action type, then the parked buckets. */
export function renderQueueCounts(c: QueueCounts): string {
  return [
    `待我处理: ${dash(c.total)}`,
    renderCountsSummary(c.counts),
    `已稍后 ${dash(c.snoozed)}  已忽略 ${dash(c.dismissed)}  已完成 ${dash(c.done)}`,
  ].join('\n');
}

const TRANSITION_LABELS = { dismiss: '已忽略', snooze: '已稍后处理', done: '已标记处理', reopen: '已重新打开' } as const;
export type Transition = keyof typeof TRANSITION_LABELS;

const withTitle = (item?: QueueItem | null) => (item?.title ? ` — ${item.title}` : '');

export function renderTransition(kind: Transition, id: number, item?: QueueItem | null): string {
  const until = kind === 'snooze' && item?.snoozedUntil ? `，至 ${fmtDateTime(item.snoozedUntil)} UTC` : '';
  return `✓ 队列项 #${id} ${TRANSITION_LABELS[kind]} (${dash(item?.status)})${until}${withTitle(item)}`;
}

const OUTCOME_LABELS: Record<string, string> = { approved: '已批准', rejected: '已驳回' };

export function renderDecision(id: number, result?: QueueActionResult | null): string {
  const outcome = result?.outcome ?? '';
  const resumed = result?.item?.actionType === 'PLAN_APPROVAL' && outcome === 'approved' ? '，已恢复 Agent 执行' : '';
  return `✓ 队列项 #${id} ${OUTCOME_LABELS[outcome] ?? DASH} (${dash(result?.outcome)})${resumed}${withTitle(result?.item)}`;
}
