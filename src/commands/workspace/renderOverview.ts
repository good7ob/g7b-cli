import { ApiDate, dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';
import { QueueCounts, renderQueueCounts } from './render';
import { MyProduct, TaskGroupCounts, productTable, renderTaskCounts } from './renderViews';

export interface Activity {
  type?: string | null;
  at?: ApiDate;
  taskId?: number | null;
  taskName?: string | null;
  text?: string | null;
  actor?: string | null;
}

/** `GET /workspace/overview`. Each block is null when it failed to load (its name is then in `degraded`). */
export interface Overview {
  queue?: QueueCounts | null;
  tasks?: TaskGroupCounts | null;
  products?: MyProduct[] | null;
  recentActivity?: Activity[] | null;
  degraded?: string[] | null;
}

const ACTIVITY_LABELS: Record<string, string> = { STATE_CHANGE: '状态变更', COMMENT: '评论', AI_WORK: 'AI 工作' };
const FAILED = '（加载失败）';

const section = (title: string, body: string) => `── ${title} ──\n${body}`;

function productsBlock(products: MyProduct[] | null | undefined): string {
  if (!products) return FAILED;
  return products.length ? productTable(products) : '没有产品。';
}

function activityBlock(activity: Activity[] | null | undefined): string {
  if (!activity) return FAILED;
  if (!activity.length) return '暂无动态。';
  const rows = [['时间', '类型', '任务', '执行方', '内容']].concat(
    activity.map((a) => [
      fmtDateTime(a.at), ACTIVITY_LABELS[a.type ?? ''] ?? dash(a.type),
      a.taskId ? `#${a.taskId} ${dash(a.taskName)}` : dash(a.taskName), dash(a.actor), dash(a.text),
    ])
  );
  return renderTable(rows, { 2: { truncate: 30 }, 4: { truncate: 50 } });
}

export function renderOverview(o: Overview): string {
  const parts = [
    section('待办队列', o.queue ? renderQueueCounts(o.queue) : FAILED),
    section('我的任务', o.tasks ? renderTaskCounts(o.tasks) : FAILED),
    section('我的产品（开放任务最多的前 5 个）', productsBlock(o.products)),
    section('最近动态', activityBlock(o.recentActivity)),
  ];
  if (o.degraded?.length) parts.push(`⚠ 部分内容加载失败: ${o.degraded.join(', ')}`);
  return parts.join('\n\n');
}
