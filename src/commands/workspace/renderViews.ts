import { ApiDate, DASH, dash, fmtDateTime, fmtNum, renderTable } from '../../utils/cliHelpers';

/** Renderers for `workspace tasks / products / orgs`; overview (renderOverview.ts) reuses the product table and counters. */

export interface MyTask {
  id?: number | null;
  name?: string | null;
  status?: string | null;
  priority?: string | null;
  deadline?: ApiDate;
  projectId?: number | null;
  projectName?: string | null;
  productId?: number | null;
  progress?: number | null;
  executorType?: string | null;
}

export type TaskGroupCounts = Record<string, number | null>;

/** Paged result of `GET /workspace/my-tasks?group=…`. */
export interface MyTaskGroup {
  group?: string | null;
  pageNum?: number | null;
  pageSize?: number | null;
  total?: number | null;
  counts?: TaskGroupCounts | null;
  items?: MyTask[] | null;
}

/** MVP result of `GET /workspace/my-tasks` without a group. */
export interface MyTasksSummary {
  total?: number | null;
  summary?: Record<string, number | null> | null;
  items?: MyTask[] | null;
}

export interface MyProduct {
  productId?: number | null;
  name?: string | null;
  orgId?: number | null;
  orgName?: string | null;
  status?: string | null;
  archived?: boolean | null;
  owned?: boolean | null;
  participating?: boolean | null;
  following?: boolean | null;
  myOpenTasks?: number | null;
  blockedCount?: number | null;
  aiWorkingCount?: number | null;
  progress?: number | null;
  riskLevel?: string | null;
}

export interface MyProducts {
  scope?: string | null;
  total?: number | null;
  items?: MyProduct[] | null;
}

export interface MyOrg {
  orgId?: number | null;
  name?: string | null;
  myRole?: string | null;
  memberCount?: number | null;
  aiEmployeeCount?: number | null;
  productCount?: number | null;
  activeTaskCount?: number | null;
}

export interface MyOrgs {
  total?: number | null;
  items?: MyOrg[] | null;
}

const GROUP_LABELS: Record<string, string> = {
  today: '今日', todo: '待开始', inProgress: '进行中', waiting: '等待中', blocked: '已阻塞', done: '已完成',
};
const SUMMARY_LABELS: Record<string, string> = { today: '今日', inProgress: '进行中', awaiting: '待审批', overdue: '已逾期' };

const labelled = (labels: Record<string, string>, values?: Record<string, number | null> | null) =>
  Object.keys(labels).map((k) => `${labels[k]} ${dash(values?.[k])}`).join('  ');

/** `今日 5  待开始 3 …` — groups overlap, so these never add up to a total. */
export const renderTaskCounts = (counts?: TaskGroupCounts | null) => labelled(GROUP_LABELS, counts);

function taskTable(items: MyTask[]): string {
  const rows = [['ID', '名称', '状态', '优先级', '截止', '项目', '进度', '执行者']].concat(
    items.map((t) => [
      dash(t.id), dash(t.name), dash(t.status), dash(t.priority), fmtDateTime(t.deadline),
      dash(t.projectName ?? t.projectId), fmtNum(t.progress, '%', 0), dash(t.executorType),
    ])
  );
  return renderTable(rows, { 1: { truncate: 40 }, 5: { truncate: 20 } });
}

export function renderTaskGroup(vo: MyTaskGroup): string {
  const items = vo.items ?? [];
  const pageNum = vo.pageNum ?? 1;
  const pageSize = vo.pageSize ?? 20;
  const total = typeof vo.total === 'number' ? vo.total : items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const lines = [`分组: ${dash(vo.group)}  共 ${total} 条，第 ${pageNum}/${pages} 页`, renderTaskCounts(vo.counts)];
  if (!items.length) return [...lines, '', '该分组没有任务。'].join('\n');
  lines.push('', taskTable(items));
  if (pageNum < pages) lines.push(`下一页: --page ${pageNum + 1}`);
  return lines.join('\n');
}

export function renderMyTasks(vo: MyTasksSummary): string {
  const items = vo.items ?? [];
  const lines = [`我的开放任务: ${dash(vo.total)}`, labelled(SUMMARY_LABELS, vo.summary)];
  if (!items.length) return [...lines, '', '没有开放任务。'].join('\n');
  lines.push('', taskTable(items));
  if (typeof vo.total === 'number' && vo.total > items.length) {
    lines.push(`显示最紧急的 ${items.length} / ${vo.total} 条（用 --limit 调大，最大 50；或用 --group 分页浏览）`);
  }
  return lines.join('\n');
}

const relation = (p: MyProduct) => {
  const tags = [p.owned && '创建', p.participating && '参与', p.following && '关注'].filter(Boolean);
  return tags.length ? tags.join('/') : DASH;
};

const NOT_EVALUATED_NOTE = '进度 / 风险只评估前 20 张卡片，其余显示 —';

/** Product cards as a table; `progress`/`riskLevel` are null for cards the backend did not evaluate (noted below the table). */
export function productTable(items: MyProduct[]): string {
  const rows = [['产品ID', '产品', '组织', '状态', '关系', '我的任务', '阻塞', 'AI进行中', '进度', '风险']].concat(
    items.map((p) => [
      dash(p.productId), dash(p.name), dash(p.orgName ?? p.orgId), dash(p.status), relation(p),
      dash(p.myOpenTasks), dash(p.blockedCount), dash(p.aiWorkingCount), fmtNum(p.progress, '%', 1), dash(p.riskLevel),
    ])
  );
  const table = renderTable(rows, { 1: { truncate: 30 }, 2: { truncate: 20 } });
  return items.some((p) => p.progress === null || p.progress === undefined) ? `${table}\n${NOT_EVALUATED_NOTE}` : table;
}

export function renderProducts(vo: MyProducts): string {
  const items = vo.items ?? [];
  const head = `范围: ${dash(vo.scope)}  共 ${dash(vo.total)} 个产品`;
  if (!items.length) return `${head}\n\n没有产品。`;
  return [head, '', productTable(items)].join('\n');
}

export function renderOrgs(vo: MyOrgs): string {
  const items = vo.items ?? [];
  if (!items.length) return '你还不是任何组织的成员。';
  const rows = [['组织ID', '名称', '我的角色', '成员', 'AI员工', '产品', '活跃任务']].concat(
    items.map((o) => [
      dash(o.orgId), dash(o.name), dash(o.myRole), dash(o.memberCount), dash(o.aiEmployeeCount),
      dash(o.productCount), dash(o.activeTaskCount),
    ])
  );
  return `${renderTable(rows, { 1: { truncate: 30 } })}\n共 ${dash(vo.total)} 个组织`;
}
