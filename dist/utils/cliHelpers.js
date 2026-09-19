"use strict";
/**
 * Small helpers shared by the idea / workspace / pm-health command groups:
 * input validation at the CLI boundary, null-safe formatting, and mapping of
 * backend business codes to readable errors.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTable = exports.fail = exports.describeError = exports.AUTH_CODES = exports.requireText = exports.checkMaxLength = exports.requireOneOf = exports.parseIntInRange = exports.parseId = exports.InputError = exports.fmtNum = exports.fmtDate = exports.dash = exports.DASH = void 0;
const table_1 = require("table");
/** Shown for any value the backend could not compute. Never render null as 0. */
exports.DASH = '—';
function dash(value) {
    return value === null || value === undefined || value === '' ? exports.DASH : String(value);
}
exports.dash = dash;
function fmtDate(value) {
    if (!Array.isArray(value))
        return dash(value);
    const [y, mo, d, h, mi, s] = value.map((n) => Number(n));
    if (![y, mo, d].every(Number.isFinite))
        return exports.DASH;
    const two = (n) => String(n ?? 0).padStart(2, '0');
    const date = `${y}-${two(mo)}-${two(d)}`;
    return value.length > 3 ? `${date} ${two(h)}:${two(mi)}:${two(s)}` : date;
}
exports.fmtDate = fmtDate;
/** Null -> "—"; otherwise the number rounded to `digits` with trailing zeros dropped. */
function fmtNum(value, suffix = '', digits = 2) {
    if (value === null || value === undefined || Number.isNaN(Number(value)))
        return exports.DASH;
    return `${Number(Number(value).toFixed(digits))}${suffix}`;
}
exports.fmtNum = fmtNum;
// ── Input validation (throws InputError with a message meant for the terminal) ──
/** A bad flag/argument, rejected before any HTTP call. */
class InputError extends Error {
}
exports.InputError = InputError;
function parseId(raw, label) {
    if (raw === undefined || !/^[1-9][0-9]*$/.test(raw.trim())) {
        throw new InputError(`${label} 必须是正整数，收到: ${raw === undefined ? '(空)' : raw}`);
    }
    return parseInt(raw.trim(), 10);
}
exports.parseId = parseId;
function parseIntInRange(raw, label, min, max) {
    if (!/^-?[0-9]+$/.test(String(raw).trim())) {
        throw new InputError(`${label} 必须是整数 (${min}-${max})，收到: ${raw}`);
    }
    const n = parseInt(String(raw).trim(), 10);
    if (n < min || n > max) {
        throw new InputError(`${label} 必须在 ${min} 到 ${max} 之间，收到: ${n}`);
    }
    return n;
}
exports.parseIntInRange = parseIntInRange;
function requireOneOf(value, allowed, label) {
    if (!allowed.includes(value)) {
        throw new InputError(`${label} 取值无效: ${value}（可选: ${allowed.join(' | ')}）`);
    }
    return value;
}
exports.requireOneOf = requireOneOf;
function checkMaxLength(value, max, label) {
    if (value.length > max) {
        throw new InputError(`${label} 最多 ${max} 个字符，当前 ${value.length} 个`);
    }
    return value;
}
exports.checkMaxLength = checkMaxLength;
function requireText(value, max, label) {
    if (value === undefined || !value.trim()) {
        throw new InputError(`${label} 不能为空`);
    }
    return checkMaxLength(value, max, label);
}
exports.requireText = requireText;
/** Codes every login-gated endpoint can answer with. */
exports.AUTH_CODES = {
    401: '未登录或凭证已失效，请先运行 good7ob config set api-key <key>',
    999: '未登录或凭证已失效，请先运行 good7ob config set api-key <key>',
};
/**
 * Business failures arrive as HTTP 200 + non-200 `code` (ApiClient.unwrap turns
 * that into an Error carrying `.code`). Map the known ones, keep the server's
 * own message next to it so nothing is lost.
 */
function describeError(error, codeMap = {}) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error?.code;
    if (typeof code !== 'number')
        return message;
    const known = { ...exports.AUTH_CODES, ...codeMap }[code];
    if (!known)
        return `${message} (code=${code})`;
    return message && message !== known ? `${known} [${code}: ${message}]` : `${known} [${code}]`;
}
exports.describeError = describeError;
function fail(prefix, error, codeMap = {}) {
    console.error(error instanceof InputError ? `✗ 参数错误: ${error.message}` : `✗ ${prefix}: ${describeError(error, codeMap)}`);
    process.exit(1);
}
exports.fail = fail;
// ── Tables (the `table` package handles CJK width, unlike String#padEnd) ──
function renderTable(rows, columnConfig = {}) {
    const columns = {};
    Object.entries(columnConfig).forEach(([i, cfg]) => {
        columns[Number(i)] = { paddingLeft: 0, paddingRight: 2, ...cfg };
    });
    return (0, table_1.table)(rows, {
        border: (0, table_1.getBorderCharacters)('void'),
        columnDefault: { paddingLeft: 0, paddingRight: 2 },
        columns,
        drawHorizontalLine: () => false,
    }).replace(/[ \t]+$/gm, '').trimEnd();
}
exports.renderTable = renderTable;
//# sourceMappingURL=cliHelpers.js.map