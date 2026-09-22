import { ApiDate, dash, fmtDateTime, renderTable } from '../../../utils/cliHelpers';

/** ActivityVo as api-0092 returns it. */
export interface Activity {
  id?: number | null;
  projectId?: number | null;
  taskId?: number | null;
  taskName?: string | null;
  type?: string | null;
  actorType?: string | null;
  actorId?: string | number | null;
  actorName?: string | null;
  actorAvatarUrl?: string | null;
  channel?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: ApiDate;
}

export interface ActivityPage {
  items?: Activity[] | null;
  nextSinceId?: number | null;
  hasMore?: boolean | null;
}

const actorCell = (a: Activity) =>
  a.actorName ? String(a.actorName) : a.actorType ? `${a.actorType}${a.actorId ? `:${a.actorId}` : ''}` : dash(a.actorName);

const taskCell = (a: Activity) => (a.taskId ? `#${a.taskId}${a.taskName ? ` ${a.taskName}` : ''}` : dash(a.taskName));

/** Table + the cursor footer; renderTable strips control characters from every cell (rp-pm-activity-0042). */
export function renderActivityList(page: ActivityPage): string {
  const items = page.items ?? [];
  const footer = `nextSinceId=${dash(page.nextSinceId)} hasMore=${dash(page.hasMore)}`;
  if (!items.length) return `没有符合条件的动态。\n${footer}`;
  const rows = [['ID', '时间', '来源', '渠道', '类型', '任务', '摘要']].concat(
    items.map((a) => [
      dash(a.id), fmtDateTime(a.createdAt), actorCell(a), dash(a.channel), dash(a.type), taskCell(a), dash(a.summary),
    ])
  );
  return `${renderTable(rows, { 2: { truncate: 24 }, 5: { truncate: 30 }, 6: { truncate: 80 } })}\n${footer}`;
}
