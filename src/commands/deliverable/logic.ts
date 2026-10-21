/** Pure helpers of `good7ob deliverable` (成果物台账): kinds, JST periods and rendering. */
import { InputError, fmtDateTime, parseDate, renderTable } from '../../utils/cliHelpers';

export const KINDS = ['pull_request', 'rule_point', 'ui_design', 'arc_design', 'db_design', 'api_design', 'plan', 'task', 'ai_deliverable'] as const;
export const PERIODS = ['today', 'week', 'month'] as const;

export const KIND_LABEL: Record<string, string> = {
  pull_request: '合并 PR', rule_point: '需求点', ui_design: 'UI 设计', arc_design: '架构设计', db_design: 'DB 设计',
  api_design: 'API 设计', plan: '计划', task: '任务完成', ai_deliverable: 'AI 交付物',
};

export interface LedgerItem {
  id: number; kind: string; action: string; title: string; url: string | null;
  actorName: string | null; occurredAt: number | string | null; sourceRef: string;
}
export interface LedgerGroup { kind: string; count: number; items: LedgerItem[] }
export interface Ledger { productId: number; from: string; to: string; total: number; groups: LedgerGroup[] }
export interface CollectResult { productId: number; from: string; to: string; inserted: number; byKind: Record<string, number> }

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 3_600_000;

const ymd = (jstMs: number): string => new Date(jstMs).toISOString().slice(0, 10);

/** today / Monday..today / 1st..today as `yyyy-MM-dd` in Asia/Tokyo (the platform's day), whatever the local zone. */
export function periodRange(period: string, nowMs: number = Date.now()): { from: string; to: string } {
  const jst = nowMs + JST_OFFSET_MS;
  const today = ymd(jst);
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') return { from: ymd(jst - ((new Date(jst).getUTCDay() + 6) % 7) * DAY_MS), to: today };
  if (period === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  throw new InputError(`--period 取值无效: ${period}（可选: ${PERIODS.join(' | ')}）`);
}

export interface PeriodOpts { period?: string; from?: string; to?: string }

/** `--period` or `--from/--to` (not both); neither means the backend default (today). */
export function resolvePeriod(o: PeriodOpts, nowMs?: number): { from?: string; to?: string } {
  if (o.period && (o.from || o.to)) throw new InputError('--period 不能与 --from / --to 同时使用');
  if (o.period) return periodRange(o.period, nowMs);
  const from = o.from === undefined ? undefined : parseDate(o.from, '--from');
  const to = o.to === undefined ? undefined : parseDate(o.to, '--to');
  if (from && to && to < from) throw new InputError(`--to 不能早于 --from: ${from} ~ ${to}`);
  return { from, to };
}

/** `yyyy-MM-dd` or `yyyy-MM-ddTHH:mm[:ss]` (JST), as the backend accepts for occurredAt. */
export function parseOccurredAt(raw: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?$/.exec(raw.trim());
  if (!m) throw new InputError(`--at 必须是 yyyy-MM-dd 或 yyyy-MM-ddTHH:mm[:ss]，收到: ${raw}`);
  parseDate(m[1], '--at');
  return m[2] ? `${m[1]}T${m[2]}` : m[1];
}

/** `--detail '{"k":"v"}'` -> object; arrays, scalars and invalid JSON are rejected. */
export function parseDetail(raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new InputError('--detail 必须是合法的 JSON 对象');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new InputError('--detail 必须是 JSON 对象，如 \'{"version":"1.0.0"}\'');
  return value as Record<string, unknown>;
}

export function renderCollect(r: CollectResult): string {
  const parts = KINDS.filter((k) => (r.byKind?.[k] ?? 0) > 0).map((k) => `${KIND_LABEL[k]} ${r.byKind[k]}`);
  return `采集完成 ${r.from} ~ ${r.to}：新增 ${r.inserted} 条${parts.length ? `（${parts.join('，')}）` : ''}`;
}

export function renderLedger(l: Ledger): string {
  if (!l.groups?.length) return `${l.from} ~ ${l.to}：没有成果物（先 good7ob deliverable collect？）`;
  const blocks = l.groups.map((g) => {
    const note = g.count > g.items.length ? `，仅显示前 ${g.items.length} 条` : '';
    const rows = g.items.map((i) => [String(i.id), fmtDateTime(i.occurredAt), i.action, i.title, i.actorName ?? '—', i.url ?? '—']);
    return `■ ${KIND_LABEL[g.kind] ?? g.kind}（${g.count}${note}）\n${renderTable([['ID', '时间', '动作', '标题', '执行者', '链接'], ...rows])}`;
  });
  return [`${l.from} ~ ${l.to}：共 ${l.total} 项`, ...blocks].join('\n');
}
