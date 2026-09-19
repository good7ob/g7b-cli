/**
 * CLI-boundary validation for the C2 what-if / explain / management-report commands (backend
 * WhatIfService, ProgressExplainService, ReportPeriod, ManagementReportService — api-0090 §11-§13).
 * Limits mirror the backend so a bad value is rejected here instead of as a 1001 round-trip.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  InputError, checkMaxLength, parseDate, parseId, parseIntInRange, requireOneOf,
} from '../../../utils/cliHelpers';
import { MAX_PAGE_SIZE } from './input';
import { MIN_ENTRY_DATE, releaseParams } from './costInput';

export const MAX_QUESTION = 500;
export const MAX_SCOPE = 1e9;
export const MAX_EXTRA_CAPACITY = 1e6;
export const MIN_MULTIPLIER = 0.1;
export const MAX_MULTIPLIER = 10;
export const MAX_DEADLINE = '2100-01-01';
export const PERIOD_TYPES = ['week', 'month', 'custom'] as const;
/** Longest custom report period, both end days counted. */
export const MAX_REPORT_DAYS = 92;

const DAY_MS = 86_400_000;
const DECIMAL = /^[0-9]+(\.[0-9]+)?$/;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A non-negative decimal within [min, max]. */
export function parseBounded(raw: string | undefined, label: string, min: number, max: number): number {
  const text = raw?.trim();
  if (text === undefined || !DECIMAL.test(text)) {
    throw new InputError(`${label} 必须是数字（${min} 到 ${max}），收到: ${raw ?? '(空)'}`);
  }
  const value = Number(text);
  if (value < min || value > max) throw new InputError(`${label} 必须在 ${min} 到 ${max} 之间，收到: ${raw}`);
  return value;
}

export interface WhatIfOptions {
  addScope?: string; removeScope?: string; velocityMultiplier?: string; extraCapacity?: string; deadline?: string; release?: string;
}

/** Every field is optional (no flag at all = "scenario equals baseline", which the backend answers with a warning). */
export function buildWhatIfBody(o: WhatIfOptions): Record<string, number | string> {
  const body: Record<string, number | string> = { ...releaseParams(o.release) };
  if (o.addScope !== undefined) body.addScope = parseBounded(o.addScope, '--add-scope', 0, MAX_SCOPE);
  if (o.removeScope !== undefined) body.removeScope = parseBounded(o.removeScope, '--remove-scope', 0, MAX_SCOPE);
  if (o.velocityMultiplier !== undefined) {
    body.velocityMultiplier = parseBounded(o.velocityMultiplier, '--velocity-multiplier', MIN_MULTIPLIER, MAX_MULTIPLIER);
  }
  if (o.extraCapacity !== undefined) body.extraWeeklyCapacity = parseBounded(o.extraCapacity, '--extra-capacity', 0, MAX_EXTRA_CAPACITY);
  if (o.deadline !== undefined) {
    const deadline = parseDate(o.deadline, '--deadline');
    if (deadline < MIN_ENTRY_DATE || deadline > MAX_DEADLINE) {
      throw new InputError(`--deadline 必须在 ${MIN_ENTRY_DATE} 到 ${MAX_DEADLINE} 之间，收到: ${o.deadline}`);
    }
    body.deadline = deadline;
  }
  return body;
}

/** A blank question counts as "no question" (the backend then asks its default one). */
export function buildExplainBody(o: { release?: string; question?: string }): Record<string, number | string> {
  const question = o.question?.trim();
  return {
    ...releaseParams(o.release),
    ...(question ? { question: checkMaxLength(question, MAX_QUESTION, '--question') } : {}),
  };
}

/** Monday of the week containing `day` (ISO weeks, as VelocityCalculator.weekStart). */
function weekStart(day: string): string {
  const ms = Date.parse(day);
  return isoDay(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS);
}

export interface ReportOptions { period?: string; from?: string; to?: string; release?: string; ai?: boolean }

function checkCustomPeriod(from: string | undefined, to: string | undefined, today: string): void {
  if (!from || !to) throw new InputError('--period custom 必须同时给出 --from 和 --to');
  if (from > to) throw new InputError(`--from (${from}) 不能晚于 --to (${to})`);
  if (to > today) throw new InputError(`--to 不能晚于今天（UTC ${today}），收到: ${to}`);
  if (from < MIN_ENTRY_DATE) throw new InputError(`--from 不能早于 ${MIN_ENTRY_DATE}，收到: ${from}`);
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
  if (days > MAX_REPORT_DAYS) throw new InputError(`自定义报告期最长 ${MAX_REPORT_DAYS} 天（含首尾），当前 ${days} 天`);
}

function checkCalendarPeriod(period: string, from: string | undefined, to: string | undefined, today: string): void {
  if (to !== undefined) {
    throw new InputError('--to 只用于 --period custom（week / month 用 --from 指定其所在的周 / 月，缺省为上一个完整周 / 月）');
  }
  if (from === undefined) return;
  const start = period === 'week' ? weekStart(from) : `${from.slice(0, 8)}01`;
  if (start > today) throw new InputError(`报告期不能在未来：${from} 所在${period === 'week' ? '周' : '月'}从 ${start} 开始，今天（UTC）是 ${today}`);
  if (start < MIN_ENTRY_DATE) throw new InputError(`--from 所在${period === 'week' ? '周' : '月'}不能早于 ${MIN_ENTRY_DATE}，收到: ${from}`);
}

/** `POST …/reports/management` body; `useAi` is only sent when asked for. */
export function buildReportBody(o: ReportOptions, now: Date = new Date()): Record<string, unknown> {
  if (o.period === undefined) throw new InputError(`--period 必填（${PERIOD_TYPES.join(' | ')}）`);
  const period = requireOneOf(o.period.trim().toLowerCase(), PERIOD_TYPES, '--period');
  const from = o.from === undefined ? undefined : parseDate(o.from, '--from');
  const to = o.to === undefined ? undefined : parseDate(o.to, '--to');
  const today = isoDay(now.getTime());
  if (period === 'custom') checkCustomPeriod(from, to, today);
  else checkCalendarPeriod(period, from, to, today);
  return {
    periodType: period,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(o.release !== undefined ? { releaseId: parseId(o.release, '--release') } : {}),
    ...(o.ai ? { useAi: true } : {}),
  };
}

export interface ReportListOptions { release?: string; period?: string; page?: string; pageSize?: string }

export function buildReportListParams(o: ReportListOptions): Record<string, string | number> {
  const params: Record<string, string | number> = {
    pageNum: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
    ...releaseParams(o.release),
  };
  if (o.period !== undefined) params.periodType = requireOneOf(o.period.trim().toLowerCase(), PERIOD_TYPES, '--period');
  return params;
}

/** `--out`: an absolute file path whose directory exists (checked before any HTTP call, so no report is generated for nothing). */
export function resolveOutPath(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (!raw.trim()) throw new InputError('--out 不能为空');
  const file = path.resolve(raw.trim());
  const dir = path.dirname(file);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new InputError(`--out 的目录不存在: ${dir}`);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) throw new InputError(`--out 是一个目录，需要文件路径: ${file}`);
  return file;
}
