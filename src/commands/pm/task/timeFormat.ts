import { randomUUID } from 'crypto';
import { DASH, InputError, fmtNum, parseId } from '../../../utils/cliHelpers';

/** Seconds -> `1h45m` / `45s` / `0s`; null -> "—". Zero parts are dropped. */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return DASH;
  const total = Math.round(Number(seconds));
  if (total === 0) return '0s';
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const [h, m, s] = [Math.floor(abs / 3600), Math.floor((abs % 3600) / 60), abs % 60];
  return sign + [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join('');
}

/** Deviation ratio 1.167 -> "116.7%"; null -> "—" (backend sends null when there is no estimate). */
export function fmtRatio(ratio: number | null | undefined): string {
  return ratio === null || ratio === undefined ? DASH : `${fmtNum(Number(ratio) * 100, '', 1)}%`;
}

/** `1h30m`, `90m`, `45s`, `1h 30m 5s` -> integer seconds. A bare number is rejected: the unit would be a guess. */
export function parseDuration(raw: string, label: string): number {
  const text = raw.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (!text || !m || (!m[1] && !m[2] && !m[3])) {
    throw new InputError(`${label} 必须带单位，如 1h30m、90m、45s，收到: ${raw}`);
  }
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Non-negative integer flag (tokens, lines, seconds ...). */
export function parseCount(raw: string, label: string): number {
  if (!/^[0-9]+$/.test(String(raw).trim()) || !Number.isSafeInteger(Number(raw))) {
    throw new InputError(`${label} 必须是非负整数，收到: ${raw}`);
  }
  return Number(raw);
}

/** Hours (decimals allowed) -> integer seconds, as the API stores them. */
export function hoursToSeconds(raw: string, label: string): number {
  const hours = Number(raw);
  if (!raw.trim() || !Number.isFinite(hours) || hours < 0) {
    throw new InputError(`${label} 必须是非负数字（小时），收到: ${raw}`);
  }
  return Math.round(hours * 3600);
}

/** Epoch ms digits, or ISO text; text without a zone is JST (the platform's wall time). Returns epoch ms. */
export function parseInstant(raw: string, label: string): number {
  const text = raw.trim();
  if (/^[0-9]{10,}$/.test(text)) return Number(text);
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) || hasZone ? text : `${text.replace(' ', 'T')}+09:00`);
  if (!/^\d{4}-\d{2}-\d{2}/.test(text) || Number.isNaN(ms)) {
    throw new InputError(`${label} 必须是毫秒时间戳或 ISO 时间（如 2026-10-25T09:00:00+09:00，无时区按 JST），收到: ${raw}`);
  }
  return ms;
}

export interface Allocation {
  taskId: number;
  weight?: number;
}

/** `1950` / `1950:2` (repeatable). Weights are all-or-none and > 0; ids unique (the API's rules, checked up front). */
export function parseAllocations(specs: string[] | undefined, label = '--task'): Allocation[] {
  if (!specs?.length) throw new InputError(`${label} 至少给一个任务，如 ${label} 1950 或 ${label} 1950:2`);
  const items = specs.map((spec): Allocation => {
    const [id, weight, ...rest] = spec.split(':');
    if (rest.length) throw new InputError(`${label} 格式应为 <任务ID>[:权重]，收到: ${spec}`);
    if (weight === undefined) return { taskId: parseId(id, label) };
    const w = Number(weight);
    if (!weight.trim() || !Number.isFinite(w) || w <= 0) throw new InputError(`${label} 的权重必须是大于 0 的数字，收到: ${spec}`);
    return { taskId: parseId(id, label), weight: w };
  });
  if (new Set(items.map((i) => i.taskId)).size !== items.length) throw new InputError(`${label} 里的任务不能重复`);
  if (items.some((i) => i.weight !== undefined) && items.some((i) => i.weight === undefined)) {
    throw new InputError(`${label} 的权重要么都给要么都不给`);
  }
  return items;
}

export const newSessionId = (): string => randomUUID();
