/**
 * CLI-boundary validation for the B2 workspace commands: `ai-team`, `ai-team log`, `daily-report`,
 * `next-actions` (api-0089 §7-§9; WorkspaceAiTeamService, WorkspaceAiWorkLogService,
 * WorkspaceDailyReportService, WorkspaceNextActionService). The backend clamps paging silently; the CLI
 * refuses out-of-range values instead, so a typo is not mistaken for a result.
 */

import { InputError, parseDate, parseId, parseIntInRange, requireOneOf } from '../../utils/cliHelpers';

export const AI_TEAM_STATUSES = ['working', 'waiting', 'error', 'idle', 'all'] as const;
export const MAX_LOG_PAGE_SIZE = 100;
export const MAX_LOG_RANGE_DAYS = 31;
export const MAX_NEXT_ACTIONS = 20;

const DAY_MS = 86_400_000;
const END_OF_DAY_MS = DAY_MS - 1;
/** `yyyy-MM-dd` (whole day) or `yyyy-MM-ddTHH:mm[:ss]` (server local time, no zone) — what the work-log accepts. */
const BOUND = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?$/;

export function buildAiTeamParams(o: { status?: string; org?: string }): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (o.status !== undefined) params.status = requireOneOf(o.status.trim().toLowerCase(), AI_TEAM_STATUSES, '--status');
  if (o.org !== undefined) params.orgId = parseId(o.org, '--org');
  return params;
}

/** A work-log bound as sent + its wall-clock ms; a date-only `to` means the end of that day, as the backend reads it. */
function parseBound(raw: string, label: string, endOfDay: boolean): { text: string; ms: number } {
  const text = raw.trim();
  const m = BOUND.exec(text);
  const [, day, h, mi, s] = m ?? [];
  if (!m || Number(h ?? 0) > 23 || Number(mi ?? 0) > 59 || Number(s ?? 0) > 59) {
    throw new InputError(`${label} 必须是 yyyy-MM-dd 或 yyyy-MM-ddTHH:mm[:ss]（无时区）的有效时间，收到: ${raw}`);
  }
  parseDate(day, label);
  const dayMs = Date.parse(day);
  const ms = h === undefined ? dayMs + (endOfDay ? END_OF_DAY_MS : 0) : dayMs + Number(h) * 3_600_000 + Number(mi) * 60_000 + Number(s ?? 0) * 1000;
  return { text, ms };
}

export interface WorkLogOptions { from?: string; to?: string; page?: string; pageSize?: string }

/** Range at most 31 days (checked when both ends are given; with only one end the backend defaults the other). */
export function buildWorkLogParams(o: WorkLogOptions): Record<string, string | number> {
  const from = o.from === undefined ? undefined : parseBound(o.from, '--from', false);
  const to = o.to === undefined ? undefined : parseBound(o.to, '--to', true);
  if (from && to) {
    if (from.ms > to.ms) throw new InputError(`--from (${from.text}) 不能晚于 --to (${to.text})`);
    if (to.ms - from.ms > MAX_LOG_RANGE_DAYS * DAY_MS) {
      throw new InputError(`--from 到 --to 的范围最多 ${MAX_LOG_RANGE_DAYS} 天，收到: ${from.text} → ${to.text}`);
    }
  }
  return {
    ...(from ? { from: from.text } : {}),
    ...(to ? { to: to.text } : {}),
    pageNum: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_LOG_PAGE_SIZE),
  };
}

/**
 * Report day: a real date, never in the future. The server judges "today" in its own zone, so the CLI
 * only refuses a day that is later than tomorrow in UTC (no zone is that far ahead); the server decides the edge.
 */
export function parseReportDate(raw: string, now: Date = new Date()): string {
  const date = parseDate(raw.trim(), '--date');
  const latest = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
  if (date > latest) throw new InputError(`--date 不能晚于今天，收到: ${raw}`);
  return date;
}

export const buildDailyReportParams = (o: { date?: string }): Record<string, string> =>
  o.date === undefined ? {} : { date: parseReportDate(o.date) };

/** `useAi` is only sent when asked for (the backend default is a deterministic report). */
export function buildDailyReportBody(o: { date?: string; ai?: boolean }): Record<string, string | boolean> {
  return { ...buildDailyReportParams(o), ...(o.ai ? { useAi: true } : {}) };
}

export const buildNextActionsParams = (o: { limit?: string }): Record<string, number> => ({
  limit: parseIntInRange(o.limit ?? '5', '--limit', 1, MAX_NEXT_ACTIONS),
});
