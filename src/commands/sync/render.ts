import { dash, fmtDateTime } from '../../utils/cliHelpers';

export interface SyncItem {
  source: 'ACTIVITY' | 'MENTION' | string;
  reasons?: string[] | null;
  id?: number | null;
  projectId?: number | null;
  taskId?: number | null;
  taskName?: string | null;
  type?: string | null;
  actorName?: string | null;
  summary?: string | null;
  createdAt?: string | null;
  commentId?: number | null;
  targetType?: string | null;
  targetId?: number | null;
}

export interface SyncResult {
  identity: { kind: 'user' | 'emp'; id: number };
  orgId: number;
  firstSync: boolean;
  windowStart: string | null;
  previousSyncAt: string | null;
  items: SyncItem[];
  nextCursor: string;
  truncated: boolean;
}

/** Tasks listed in the text view; the rest are counted (the full list is in --json). */
export const MAX_TASK_GROUPS = 30;

/** Server times are JST wall-clock (naive) strings; drop the fractional seconds. */
const serverTime = (v: unknown) => fmtDateTime(v).replace(/\.\d+$/, '');

/** Our own timestamp is an ISO instant (UTC); show it as JST like everything else the platform prints. */
function localTime(iso: string | null): string {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? new Date(t + 9 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') : dash(null);
}

const REASON: Record<string, string> = { ASSIGNED: '被分配', MENTIONED: '提及我', FOLLOWED: '关注的产品' };

/** Activities grouped per task, in order of first appearance; each group lists its types with counts. */
function groupByTask(items: SyncItem[]) {
  const groups = new Map<string, { item: SyncItem; reasons: Set<string>; types: Map<string, number>; last: SyncItem }>();
  for (const it of items.filter((i) => i.source === 'ACTIVITY')) {
    const key = String(it.taskId ?? `p${it.projectId}`);
    let g = groups.get(key);
    if (!g) {
      g = { item: it, reasons: new Set(), types: new Map(), last: it };
      groups.set(key, g);
    }
    (it.reasons ?? []).forEach((r) => g!.reasons.add(r));
    g.types.set(it.type ?? '?', (g.types.get(it.type ?? '?') ?? 0) + 1);
    g.last = it;
  }
  return [...groups.values()];
}

export function renderSync(r: SyncResult): string {
  const who = r.identity.kind === 'emp' ? `AI 员工 #${r.identity.id}` : `用户 #${r.identity.id}`;
  const lines = [`同步完成  ${who} · 组织 ${r.orgId}`];
  lines.push(
    r.firstSync
      ? `首次同步：取最近 7 天，自 ${serverTime(r.windowStart)} 起`
      : `上次同步：${localTime(r.previousSyncAt)}`
  );

  const tasks = groupByTask(r.items);
  const mentions = r.items.filter((i) => i.source === 'MENTION');
  if (tasks.length === 0 && mentions.length === 0) {
    lines.push('', '无新的变化。');
  } else {
    lines.push(`本次 ${r.items.length} 条：${tasks.length} 个任务有变化，${mentions.length} 条提及`);
  }

  if (tasks.length > 0) {
    lines.push('', '── 任务变化 ──');
    for (const g of tasks.slice(0, MAX_TASK_GROUPS)) {
      const why = [...g.reasons].map((x) => REASON[x] ?? x).join(' · ');
      lines.push(`#${dash(g.item.taskId)} ${dash(g.item.taskName)}${why ? `  [${why}]` : ''}`);
      const types = [...g.types.entries()].map(([t, n]) => (n > 1 ? `${t}×${n}` : t)).join(', ');
      lines.push(`   ${types}  最近 ${serverTime(g.last.createdAt)} ${dash(g.last.actorName)}`);
    }
  }
  if (tasks.length > MAX_TASK_GROUPS) {
    lines.push(`… 另有 ${tasks.length - MAX_TASK_GROUPS} 个任务有变化，完整列表用 --json 查看`);
  }
  if (mentions.length > 0) {
    lines.push('', '── 提及我 ──');
    for (const m of mentions) {
      const where = m.taskId ? `任务 #${m.taskId}` : `${dash(m.targetType)} #${dash(m.targetId)}`;
      lines.push(`评论 #${dash(m.commentId ?? m.id)}（${where}）${dash(m.actorName)}：${dash(m.summary)}`);
    }
  }
  if (r.truncated) lines.push('', '还有更多：已达单次页数上限，请再次执行 good7ob sync 继续。');
  return lines.join('\n');
}
