import { ApiDate, dash, fmtDate, renderTable } from '../../utils/cliHelpers';

export interface QueueItem {
  sourceType?: string | null;
  sourceId?: number | null;
  title?: string | null;
  actionType?: string | null;
  priority?: string | null;
  projectId?: number | null;
  projectName?: string | null;
  createdAt?: ApiDate;
}

export interface MyQueue {
  total?: number | null;
  counts?: Record<string, number | null> | null;
  items?: QueueItem[] | null;
}

export const ACTION_LABELS: Record<string, string> = {
  PLAN_APPROVAL: '计划审批',
  COMPLETION_APPROVAL: '完成审批',
  INFO_REQUEST: '信息请求',
  BLOCKED: '已阻塞',
  PAUSED: '已暂停',
  SYSTEM_ALERT: '系统提醒',
  REQUIREMENT_TRIAGE: '需求分诊',
};

export function renderQueue(queue: MyQueue): string {
  const items = queue.items ?? [];
  const counts = queue.counts ?? {};
  const summary = Object.keys(ACTION_LABELS)
    .map((k) => `${ACTION_LABELS[k]} ${dash(counts[k])}`)
    .join('  ');
  const lines = [`待我处理: ${dash(queue.total)}`, summary];

  if (!items.length) return [...lines, '', '队列为空。'].join('\n');

  const rows = [['类型', 'ID', '动作', '优先级', '项目', '标题', '创建时间']].concat(
    items.map((i) => [
      dash(i.sourceType), dash(i.sourceId), ACTION_LABELS[i.actionType ?? ''] ?? dash(i.actionType),
      dash(i.priority), dash(i.projectName ?? i.projectId), dash(i.title), fmtDate(i.createdAt),
    ])
  );
  lines.push('', renderTable(rows, { 4: { truncate: 20 }, 5: { truncate: 40 } }));
  if (typeof queue.total === 'number' && queue.total > items.length) {
    lines.push(`显示 ${items.length} / ${queue.total} 条（用 --limit 调大，最大 200）`);
  }
  return lines.join('\n');
}
