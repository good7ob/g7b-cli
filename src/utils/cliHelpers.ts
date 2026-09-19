/**
 * Small helpers shared by the idea / workspace / pm-health command groups:
 * input validation at the CLI boundary, null-safe formatting, and mapping of
 * backend business codes to readable errors.
 */

import { table, getBorderCharacters, ColumnUserConfig } from 'table';

/** Shown for any value the backend could not compute. Never render null as 0. */
export const DASH = '—';

export function dash(value: unknown): string {
  return value === null || value === undefined || value === '' ? DASH : String(value);
}

/**
 * Some endpoints serialize LocalDateTime/LocalDate as [y,m,d,h,mi,s,nanos] arrays
 * (seen live on /workspace/my-queue) rather than ISO strings. Normalise both.
 */
/** ISO string, or the [y,m,d,...] array form. */
export type ApiDate = string | number[] | null;

export function fmtDate(value: unknown): string {
  if (!Array.isArray(value)) return dash(value);
  const [y, mo, d, h, mi, s] = value.map((n) => Number(n));
  if (![y, mo, d].every(Number.isFinite)) return DASH;
  const two = (n: number | undefined) => String(n ?? 0).padStart(2, '0');
  const date = `${y}-${two(mo)}-${two(d)}`;
  return value.length > 3 ? `${date} ${two(h)}:${two(mi)}:${two(s)}` : date;
}

/** Null -> "—"; otherwise the number rounded to `digits` with trailing zeros dropped. */
export function fmtNum(value: number | null | undefined, suffix = '', digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return DASH;
  return `${Number(Number(value).toFixed(digits))}${suffix}`;
}

// ── Input validation (throws InputError with a message meant for the terminal) ──

/** A bad flag/argument, rejected before any HTTP call. */
export class InputError extends Error {}

export function parseId(raw: string | undefined, label: string): number {
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw.trim())) {
    throw new InputError(`${label} 必须是正整数，收到: ${raw === undefined ? '(空)' : raw}`);
  }
  return parseInt(raw.trim(), 10);
}

export function parseIntInRange(raw: string, label: string, min: number, max: number): number {
  if (!/^-?[0-9]+$/.test(String(raw).trim())) {
    throw new InputError(`${label} 必须是整数 (${min}-${max})，收到: ${raw}`);
  }
  const n = parseInt(String(raw).trim(), 10);
  if (n < min || n > max) {
    throw new InputError(`${label} 必须在 ${min} 到 ${max} 之间，收到: ${n}`);
  }
  return n;
}

export function requireOneOf<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new InputError(`${label} 取值无效: ${value}（可选: ${allowed.join(' | ')}）`);
  }
  return value as T;
}

export function checkMaxLength(value: string, max: number, label: string): string {
  if (value.length > max) {
    throw new InputError(`${label} 最多 ${max} 个字符，当前 ${value.length} 个`);
  }
  return value;
}

export function requireText(value: string | undefined, max: number, label: string): string {
  if (value === undefined || !value.trim()) {
    throw new InputError(`${label} 不能为空`);
  }
  return checkMaxLength(value, max, label);
}

// ── Errors ──

export type ErrorCodeMap = Record<number, string>;

/** Codes every login-gated endpoint can answer with. */
export const AUTH_CODES: ErrorCodeMap = {
  401: '未登录或凭证已失效，请先运行 good7ob config set api-key <key>',
  999: '未登录或凭证已失效，请先运行 good7ob config set api-key <key>',
};

/**
 * Business failures arrive as HTTP 200 + non-200 `code` (ApiClient.unwrap turns
 * that into an Error carrying `.code`). Map the known ones, keep the server's
 * own message next to it so nothing is lost.
 */
export function describeError(error: unknown, codeMap: ErrorCodeMap = {}): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'number') return message;
  const known = { ...AUTH_CODES, ...codeMap }[code];
  if (!known) return `${message} (code=${code})`;
  return message && message !== known ? `${known} [${code}: ${message}]` : `${known} [${code}]`;
}

export function fail(prefix: string, error: unknown, codeMap: ErrorCodeMap = {}): never {
  console.error(error instanceof InputError ? `✗ 参数错误: ${error.message}` : `✗ ${prefix}: ${describeError(error, codeMap)}`);
  process.exit(1);
}

// ── Tables (the `table` package handles CJK width, unlike String#padEnd) ──

export function renderTable(rows: string[][], columnConfig: Record<number, ColumnUserConfig> = {}): string {
  const columns: Record<number, ColumnUserConfig> = {};
  Object.entries(columnConfig).forEach(([i, cfg]) => {
    columns[Number(i)] = { paddingLeft: 0, paddingRight: 2, ...cfg };
  });
  return table(rows, {
    border: getBorderCharacters('void'),
    columnDefault: { paddingLeft: 0, paddingRight: 2 },
    columns,
    drawHorizontalLine: () => false,
  }).replace(/[ \t]+$/gm, '').trimEnd();
}
