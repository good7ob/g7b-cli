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

/** Same as fmtDate, but for `yyyy-MM-dd'T'HH:mm:ss` strings shows `yyyy-MM-dd HH:mm:ss`. */
export function fmtDateTime(value: unknown): string {
  return fmtDate(value).replace('T', ' ');
}

/** Print JSON when asked, otherwise the rendered text. */
export function emit(json: boolean | undefined, data: unknown, text: () => string): void {
  console.log(json ? JSON.stringify(data, null, 2) : text());
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
  // Beyond 2^53 a JS number silently rounds to a different id, so refuse it outright.
  if (raw === undefined || !/^[1-9][0-9]*$/.test(raw.trim()) || !Number.isSafeInteger(Number(raw.trim()))) {
    throw new InputError(`${label} 必须是正整数，收到: ${raw === undefined ? '(空)' : raw}`);
  }
  return parseInt(raw.trim(), 10);
}

/** `1,2,3` -> [1,2,3]: positive integers, de-duplicated (as the backend does), 1..max entries. */
export function parseIdList(raw: string | undefined, label: string, max: number): number[] {
  if (raw === undefined || !raw.trim()) {
    throw new InputError(`${label} 不能为空（逗号分隔的正整数，如 1,2,3）`);
  }
  const ids = Array.from(new Set(raw.split(',').map((part) => parseId(part, `${label} 的每一项`))));
  if (ids.length > max) {
    throw new InputError(`${label} 最多 ${max} 个，当前 ${ids.length} 个`);
  }
  return ids;
}

/** `yyyy-MM-dd` and a real calendar day (rejects 2026-02-30). */
export function parseDate(raw: string, label: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const real = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || real.getUTCFullYear() !== +m[1] || real.getUTCMonth() !== +m[2] - 1 || real.getUTCDate() !== +m[3]) {
    throw new InputError(`${label} 必须是 yyyy-MM-dd 格式的有效日期，收到: ${raw}`);
  }
  return raw;
}

/** Product id from `--product`, falling back to GOOD7OB_PRODUCT_ID. */
export function resolveProductId(raw?: string): number {
  const value = raw ?? process.env.GOOD7OB_PRODUCT_ID;
  if (value === undefined) {
    throw new InputError('缺少产品 ID。用 --product <id> 指定，或设置环境变量 GOOD7OB_PRODUCT_ID。');
  }
  return parseId(value, '--product');
}

/** Object type code as the backend stores it: 2-32 chars of A-Z/0-9/_, case-insensitive input. */
export function normalizeTypeCode(raw: string, label: string): string {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(code)) {
    throw new InputError(`${label} 必须是 2~32 位的字母/数字/下划线代码（如 RELEASE、IDEA），收到: ${raw}`);
  }
  return code;
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
