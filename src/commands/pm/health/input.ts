/**
 * CLI-boundary validation for the C1 progress commands (config, scope changes, burnup,
 * snapshot rebuild, release baseline). Limits mirror the backend (ProgressConfigService,
 * ScopeChangeService, BurnupService, ProgressSnapshotService) so a bad value is rejected here
 * with a clear message instead of as a 1001 round-trip.
 */

import {
  ErrorCodeMap, InputError, checkMaxLength, parseDate, parseId, parseIntInRange, requireOneOf, requireText,
} from '../../../utils/cliHelpers';

/** The NEW endpoints (Result envelope). The old /health* ones keep the 40xxx codes. */
export const PROGRESS_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数值不合法（口径/状态名/完成度范围、days 越界、日期倒置或跨度 > 366 天、Release 不属于该产品、reason/note 超长、deltaScope 为 0 等）',
  1002: '产品 / Release / 范围变更记录不存在（或已删除）',
  1008: '缺少 Release id',
  2000: '无权限：不是该产品所属组织的成员（写配置 / 重建快照需要组织 owner/admin）',
};

export const WEIGHT_BASES = ['ESTIMATED_HOURS', 'STORY_POINT', 'WEIGHT'] as const;
/** Statuses whose completion can be overridden; completed (always 100) and cancelled (out of scope) cannot. */
export const OVERRIDABLE_STATUSES = [
  'not_started', 'pending_agent', 'pending_info', 'awaiting_plan_approval', 'in_progress', 'paused',
  'awaiting_completion_approval', 'blocked',
] as const;
export const MAX_REASON = 500;
export const MAX_NOTE = 500;
export const MAX_PAGE_SIZE = 100;
export const MAX_REBUILD_DAYS = 90;
export const MAX_BURNUP_SPAN_DAYS = 366;
/** The backend rejects |delta| < 0.005 (rounding noise) and >= 1e10 (NUMERIC(12,2)). */
const MIN_DELTA = 0.005;
const MAX_DELTA = 1e10;

/** `in_progress=30,blocked=50` -> { in_progress: 30, blocked: 50 }. */
export function parseStatusCompletion(raw: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [key, value, ...extra] = part.split('=').map((s) => s.trim());
    if (!key || value === undefined || !value || extra.length) {
      throw new InputError(`--status-completion 每一项须形如 状态=完成度（如 in_progress=30,blocked=50），收到: "${part.trim()}"`);
    }
    const status = key.toLowerCase();
    if (status === 'completed' || status === 'cancelled') {
      throw new InputError(`--status-completion 不能覆盖 ${status}：completed 恒为 100，cancelled 不计入范围`);
    }
    requireOneOf(status, OVERRIDABLE_STATUSES, '--status-completion 的状态');
    if (status in result) throw new InputError(`--status-completion 里 ${status} 重复出现`);
    if (!/^[0-9]+(\.[0-9]+)?$/.test(value) || Number(value) > 100) {
      throw new InputError(`--status-completion 里 ${status} 的完成度必须是 0 到 100 的数字，收到: ${value}`);
    }
    result[status] = Number(value);
  }
  return result;
}

/** PUT replaces the whole config: omitting --status-completion clears any existing overrides. */
export function buildConfigBody(o: { basis?: string; statusCompletion?: string }) {
  if (o.basis === undefined) throw new InputError('--basis 必填（ESTIMATED_HOURS | STORY_POINT | WEIGHT）');
  const body: { weightBasis: string; statusCompletion?: Record<string, number> } = {
    weightBasis: requireOneOf(o.basis.trim().toUpperCase(), WEIGHT_BASES, '--basis'),
  };
  if (o.statusCompletion !== undefined) body.statusCompletion = parseStatusCompletion(o.statusCompletion);
  return body;
}

export function buildScopeChangesParams(o: { release?: string; page?: string; pageSize?: string }) {
  const params: Record<string, number> = {
    pageNum: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
  };
  if (o.release !== undefined) params.releaseId = parseId(o.release, '--release');
  return params;
}

export function parseDelta(raw: string | undefined): number {
  if (raw === undefined || !/^[+-]?[0-9]+(\.[0-9]+)?$/.test(raw.trim())) {
    throw new InputError(`--delta 必须是带符号的数字（如 30 或 -12.5），收到: ${raw ?? '(空)'}`);
  }
  const delta = Number(raw.trim());
  if (Math.abs(delta) < MIN_DELTA || Math.abs(delta) >= MAX_DELTA) {
    throw new InputError(`--delta 必须非零且绝对值小于 10^10（至少 ${MIN_DELTA}），收到: ${raw}`);
  }
  return delta;
}

export function buildScopeChangeBody(o: { delta?: string; reason?: string; release?: string }) {
  const body: { deltaScope: number; reason: string; releaseId?: number } = {
    deltaScope: parseDelta(o.delta),
    reason: requireText(o.reason?.trim(), MAX_REASON, '--reason'),
  };
  if (o.release !== undefined) body.releaseId = parseId(o.release, '--release');
  return body;
}

export function buildAnnotateBody(reason: string | undefined): { reason: string } {
  return { reason: requireText(reason?.trim(), MAX_REASON, '--reason') };
}

const DAY_MS = 86_400_000;

export function buildBurnupParams(o: { from?: string; to?: string; release?: string }) {
  const params: Record<string, string | number> = {};
  if (o.from !== undefined) params.from = parseDate(o.from, '--from');
  if (o.to !== undefined) params.to = parseDate(o.to, '--to');
  if (o.release !== undefined) params.releaseId = parseId(o.release, '--release');
  if (params.from && params.to) {
    const span = (Date.parse(String(params.to)) - Date.parse(String(params.from))) / DAY_MS;
    if (span < 0) throw new InputError(`--from (${params.from}) 不能晚于 --to (${params.to})`);
    if (span > MAX_BURNUP_SPAN_DAYS) throw new InputError(`--from 到 --to 的跨度最多 ${MAX_BURNUP_SPAN_DAYS} 天，当前 ${span} 天`);
  }
  return params;
}

/** `/snapshots/rebuild?days=N`, or no query at all (the backend defaults to 30). */
export function rebuildUrl(productId: number, days?: string): string {
  const base = `/progress/products/${productId}/snapshots/rebuild`;
  return days === undefined ? base : `${base}?days=${parseIntInRange(days, '--days', 1, MAX_REBUILD_DAYS)}`;
}

/** Optional note; blank counts as "no note" (the backend trims it the same way). */
export function buildNoteBody(note: string | undefined): { note?: string } {
  const trimmed = note?.trim();
  return trimmed ? { note: checkMaxLength(trimmed, MAX_NOTE, '--note') } : {};
}
