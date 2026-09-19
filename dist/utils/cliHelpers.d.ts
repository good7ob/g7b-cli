/**
 * Small helpers shared by the idea / workspace / pm-health command groups:
 * input validation at the CLI boundary, null-safe formatting, and mapping of
 * backend business codes to readable errors.
 */
import { ColumnUserConfig } from 'table';
/** Shown for any value the backend could not compute. Never render null as 0. */
export declare const DASH = "\u2014";
export declare function dash(value: unknown): string;
/**
 * Some endpoints serialize LocalDateTime/LocalDate as [y,m,d,h,mi,s,nanos] arrays
 * (seen live on /workspace/my-queue) rather than ISO strings. Normalise both.
 */
/** ISO string, or the [y,m,d,...] array form. */
export type ApiDate = string | number[] | null;
export declare function fmtDate(value: unknown): string;
/** Same as fmtDate, but for `yyyy-MM-dd'T'HH:mm:ss` strings shows `yyyy-MM-dd HH:mm:ss`. */
export declare function fmtDateTime(value: unknown): string;
/** Print JSON when asked, otherwise the rendered text (control characters stripped, see stripControl). */
export declare function emit(json: boolean | undefined, data: unknown, text: () => string): void;
/** Null -> "—"; otherwise the number rounded to `digits` with trailing zeros dropped. */
export declare function fmtNum(value: number | null | undefined, suffix?: string, digits?: number): string;
/** Commander collector for repeatable options: `--x a --x b` -> ['a', 'b']. */
export declare const collect: (value: string, prev?: string[]) => string[];
/** A bad flag/argument, rejected before any HTTP call. */
export declare class InputError extends Error {
}
export declare function parseId(raw: string | undefined, label: string): number;
/** `1,2,3` -> [1,2,3]: positive integers, de-duplicated (as the backend does), 1..max entries. */
export declare function parseIdList(raw: string | undefined, label: string, max: number): number[];
/** `yyyy-MM-dd` and a real calendar day (rejects 2026-02-30). */
export declare function parseDate(raw: string, label: string): string;
/** Product id from `--product`, falling back to GOOD7OB_PRODUCT_ID. */
export declare function resolveProductId(raw?: string): number;
/** Object type code as the backend stores it: 2-32 chars of A-Z/0-9/_, case-insensitive input. */
export declare function normalizeTypeCode(raw: string, label: string): string;
export declare function parseIntInRange(raw: string, label: string, min: number, max: number): number;
export declare function requireOneOf<T extends string>(value: string, allowed: readonly T[], label: string): T;
export declare function checkMaxLength(value: string, max: number, label: string): string;
export declare function requireText(value: string | undefined, max: number, label: string): string;
export type ErrorCodeMap = Record<number, string>;
/** Codes every login-gated endpoint can answer with. */
export declare const AUTH_CODES: ErrorCodeMap;
/**
 * Business failures arrive as HTTP 200 + non-200 `code` (ApiClient.unwrap turns
 * that into an Error carrying `.code`). Map the known ones, keep the server's
 * own message next to it so nothing is lost.
 */
export declare function describeError(error: unknown, codeMap?: ErrorCodeMap): string;
export declare function fail(prefix: string, error: unknown, codeMap?: ErrorCodeMap): never;
/** Run an action; any failure (bad input or API) ends as a readable one-line error + exit 1. */
export declare function guarded(prefix: string, codes: ErrorCodeMap, fn: () => Promise<void>): Promise<void>;
/** Client timeout for calls that may run an AI model (the default 30 s is too short). */
export declare const AI_REQUEST_CONFIG: {
    readonly timeout: 180000;
};
/**
 * Adds `hint` to a client timeout / gateway failure: the server may still be working, so a blind retry can
 * duplicate. Business errors (they carry a numeric `code`) pass through untouched so their code mapping survives.
 */
export declare function withTimeoutHint(error: unknown, hint: string): unknown;
/**
 * Report titles / bodies, AI text and names inside them carry unescaped user text (api-0090 §13: treat as
 * untrusted). A terminal is not an HTML page, but the equivalent attack is an escape sequence in a task
 * name that rewrites the screen, so strip control characters before printing. Never applied to --json / --out.
 */
export declare function stripControl(text: string): string;
export declare function renderTable(rows: string[][], columnConfig?: Record<number, ColumnUserConfig>): string;
//# sourceMappingURL=cliHelpers.d.ts.map