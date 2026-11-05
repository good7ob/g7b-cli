/** `good7ob req changes` (prd-0181 FP-6): request building, validation and rendering. Read-only. */
import { InputError, fmtDateTime, parseDate, renderTable, requireOneOf } from '../../utils/cliHelpers';

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export const LAYERS = ['FE', 'FP', 'RP'] as const;
export const ACTIONS = ['add', 'modify', 'delete'] as const;
export const ACTOR_TYPES = ['HUMAN', 'AI', 'SYSTEM', 'UNKNOWN'] as const;
export const SOURCES = ['MANUAL', 'AI_DECOMPOSE', 'PRD_SYNC', 'IMPORT', 'CHANGE_WORKBENCH', 'SYSTEM'] as const;

export interface ChangesFlags {
  product?: string; granularity?: string; from?: string; to?: string; actorType?: string; source?: string;
  layer?: string; action?: string; events?: boolean; page?: string; size?: string; json?: boolean;
}

export interface ChangesQuery { path: 'summary' | 'events'; params: Record<string, string | number | undefined> }

/** Comma list -> validated, upper/lower-cased members; undefined when the flag is absent. */
function list<T extends string>(raw: string | undefined, allowed: readonly T[], label: string, lower = false): string | undefined {
  if (raw === undefined) return undefined;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new InputError(`${label} 不能为空`);
  return parts.map((p) => requireOneOf(lower ? p.toLowerCase() : p.toUpperCase(), allowed, label)).join(',');
}

function lastDays(days: number, tz: string, now: number): { from: string; to: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return { from: fmt.format(new Date(now - (days - 1) * 86_400_000)), to: fmt.format(new Date(now)) };
}

export function buildQuery(o: ChangesFlags, tz: string, now: number = Date.now()): ChangesQuery {
  const actorType = list(o.actorType, ACTOR_TYPES, '--actor-type');
  const source = list(o.source, SOURCES, '--source');
  const from = o.from === undefined ? undefined : parseDate(o.from, '--from');
  const to = o.to === undefined ? undefined : parseDate(o.to, '--to');
  if (from && to && from > to) throw new InputError('--from 不能晚于 --to');
  if (!o.events) {
    // layer / action only narrow the event list; silently ignoring them would mislead
    if (o.layer !== undefined || o.action !== undefined || o.page !== undefined || o.size !== undefined) {
      throw new InputError('--layer / --action / --page / --size 只能与 --events 一起使用');
    }
    const granularity = o.granularity === undefined ? 'week' : requireOneOf(o.granularity, GRANULARITIES, '--granularity');
    return { path: 'summary', params: { granularity, from, to, timezone: tz, actorType, source } };
  }
  if (o.granularity !== undefined) throw new InputError('--granularity 只用于汇总，查看事件明细请用 --from / --to');
  const range = from && to ? { from, to } : lastDays(7, tz, now);
  const page = o.page === undefined ? 1 : Number(o.page);
  const size = o.size === undefined ? 20 : Number(o.size);
  if (!Number.isInteger(page) || page < 1) throw new InputError(`--page 必须是正整数，收到: ${o.page}`);
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new InputError(`--size 必须是 1-100 的整数，收到: ${o.size}`);
  return {
    path: 'events',
    params: {
      from: from ?? range.from, to: to ?? range.to, timezone: tz, page, size, actorType, source,
      layer: list(o.layer, LAYERS, '--layer'), action: list(o.action, ACTIONS, '--action', true),
    },
  };
}

interface Counts { add: number; modify: number; delete: number }
export interface Bucket {
  label: string; inProgress: boolean; total: number; deltaTotal: number | null; totalsByAction: Counts;
  byOperator: { HUMAN: number; AI: number; SYSTEM: number; UNKNOWN: number }; aiAssisted: number;
}
export interface Summary { granularity: string; timezone: string; recordStart: string | null; buckets: Bucket[] }

const delta = (d: number | null): string => (d === null ? '—' : d > 0 ? `+${d}` : String(d));

export function renderSummary(s: Summary): string {
  const rows = [['期间', '新增', '修改', '删除', '合计', '较上期', '人工', 'AI员工', '系统', '未区分']];
  s.buckets.forEach((b) => rows.push([
    b.inProgress ? `${b.label}（进行中）` : b.label, String(b.totalsByAction.add), String(b.totalsByAction.modify),
    String(b.totalsByAction.delete), String(b.total), delta(b.deltaTotal), String(b.byOperator.HUMAN),
    String(b.byOperator.AI), String(b.byOperator.SYSTEM), String(b.byOperator.UNKNOWN),
  ]));
  const note = s.recordStart
    ? `记录起点 ${fmtDateTime(s.recordStart)}；更早的期间没有记录（不是没有变化）。`
    : '该产品还没有任何需求变化记录。';
  return `需求变化（按${{ day: '日', week: '周', month: '月' }[s.granularity] ?? s.granularity}，时区 ${s.timezone}）\n${renderTable(rows)}\n${note}\n“未区分” = 操作者类型修复前写入的记录，无法区分人工与 AI 员工。`;
}

export interface EventItem {
  at: string; layer: string; nodeCode: string | null; nodeName: string | null; action: string;
  operatorType: string; operatorName: string | null; source: string | null; aiAssisted: boolean;
}
export interface Events { total: number; totalNodes: number; page: number; size: number; items: EventItem[] }

const ACTION_ZH: Record<string, string> = { add: '新增', modify: '修改', delete: '删除' };
const OPERATOR_ZH: Record<string, string> = { HUMAN: '人工', AI: 'AI员工', SYSTEM: '系统', UNKNOWN: '未区分' };

export function renderEvents(e: Events): string {
  const rows = [['时间', '层级', '编号', '名称', '动作', '操作者', '来源']];
  e.items.forEach((i) => rows.push([
    fmtDateTime(i.at), i.layer, i.nodeCode ?? '—', i.nodeName ?? '—', ACTION_ZH[i.action] ?? i.action,
    `${OPERATOR_ZH[i.operatorType] ?? i.operatorType}${i.operatorName ? `（${i.operatorName}）` : ''}${i.aiAssisted ? ' · AI辅助' : ''}`,
    i.source ?? '—',
  ]));
  return `共 ${e.total} 条事件，涉及 ${e.totalNodes} 个节点（第 ${e.page} 页，每页 ${e.size}）\n${renderTable(rows)}`;
}
