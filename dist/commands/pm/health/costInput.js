"use strict";
/**
 * CLI-boundary validation for the C2 budget / cost-entry commands (backend CostSupport,
 * ProductBudgetService, CostEntryService — api-0090 §9). Limits mirror the backend so a bad value
 * is rejected here with a clear message instead of as a 1001 round-trip. Unlike the backend, which
 * silently rounds to cents, the CLI refuses more than 2 decimals so a typo is not stored as a different amount.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCostEntryListParams = exports.buildCostEntryBody = exports.buildBudgetBody = exports.releaseParams = exports.parseIncurredOn = exports.parseCurrency = exports.parseMoney = exports.MIN_ENTRY_DATE = exports.MAX_LABOR_RATE = exports.MAX_AMOUNT = exports.COST_CATEGORIES = exports.INTEL_ERROR_CODES = void 0;
const cliHelpers_1 = require("../../../utils/cliHelpers");
const input_1 = require("./input");
/** Business codes of every C2 endpoint (Result envelope: HTTP 200 + non-200 `code`). */
exports.INTEL_ERROR_CODES = {
    1000: '缺少必填参数',
    1001: '参数值不合法（数值 / 日期越界、币种与该产品已有币种不一致、Release 不属于该产品、报告期不合法、问题超长等）',
    1002: '产品 / Release / 预算 / 成本条目 / 管理报告不存在（或已删除）',
    1007: '自动入账（source=auto）的成本条目只读，不能修改或删除',
    2000: '无权限：不是该产品所属组织的成员（预算与成本的写入需组织 owner/admin）',
};
exports.COST_CATEGORIES = ['labor', 'cloud', 'ai_token', 'other'];
exports.MAX_AMOUNT = 9999999999.99;
exports.MAX_LABOR_RATE = 100000;
exports.MIN_ENTRY_DATE = '2000-01-01';
const DAY_MS = 86400000;
const MONEY = /^[0-9]+(\.[0-9]{1,2})?$/;
/** A positive amount with at most 2 decimals, up to `max`. */
function parseMoney(raw, label, max) {
    const text = raw?.trim();
    if (text === undefined || !MONEY.test(text)) {
        throw new cliHelpers_1.InputError(`${label} 必须是最多 2 位小数的正数（如 1200.50），收到: ${raw ?? '(空)'}`);
    }
    const value = Number(text);
    if (value <= 0 || value > max) {
        throw new cliHelpers_1.InputError(`${label} 必须大于 0 且不超过 ${max}，收到: ${raw}`);
    }
    return value;
}
exports.parseMoney = parseMoney;
/** Upper-cased 3-letter currency code. */
function parseCurrency(raw, label = '--currency') {
    const code = raw?.trim().toUpperCase();
    if (!code || !/^[A-Z]{3}$/.test(code)) {
        throw new cliHelpers_1.InputError(`${label} 必须是 3 位字母币种代码（如 CNY、USD），收到: ${raw ?? '(空)'}`);
    }
    return code;
}
exports.parseCurrency = parseCurrency;
/** Day the cost was incurred: a real date from 2000-01-01 up to tomorrow (UTC), as the backend allows. */
function parseIncurredOn(raw, now = new Date()) {
    if (raw === undefined)
        throw new cliHelpers_1.InputError('--date 必填（yyyy-MM-dd）');
    const date = (0, cliHelpers_1.parseDate)(raw, '--date');
    const tomorrow = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
    if (date < exports.MIN_ENTRY_DATE || date > tomorrow) {
        throw new cliHelpers_1.InputError(`--date 必须在 ${exports.MIN_ENTRY_DATE} 到 ${tomorrow}（明天，UTC）之间，收到: ${raw}`);
    }
    return date;
}
exports.parseIncurredOn = parseIncurredOn;
const releaseParams = (release) => release === undefined ? {} : { releaseId: (0, cliHelpers_1.parseId)(release, '--release') };
exports.releaseParams = releaseParams;
function buildBudgetBody(o) {
    const body = {
        amount: parseMoney(o.amount, '--amount', exports.MAX_AMOUNT),
        currency: parseCurrency(o.currency),
        ...(0, input_1.buildNoteBody)(o.note),
        ...(0, exports.releaseParams)(o.release),
    };
    if (o.laborRate !== undefined)
        body.laborRatePerHour = parseMoney(o.laborRate, '--labor-rate', exports.MAX_LABOR_RATE);
    return body;
}
exports.buildBudgetBody = buildBudgetBody;
/** POST and PUT share this body; PUT replaces the whole entry, so an omitted --release / --note clears it. */
function buildCostEntryBody(o, now = new Date()) {
    if (o.category === undefined)
        throw new cliHelpers_1.InputError(`--category 必填（${exports.COST_CATEGORIES.join(' | ')}）`);
    return {
        category: (0, cliHelpers_1.requireOneOf)(o.category.trim().toLowerCase(), exports.COST_CATEGORIES, '--category'),
        amount: parseMoney(o.amount, '--amount', exports.MAX_AMOUNT),
        currency: parseCurrency(o.currency),
        incurredOn: parseIncurredOn(o.date, now),
        ...(0, input_1.buildNoteBody)(o.note),
        ...(0, exports.releaseParams)(o.release),
    };
}
exports.buildCostEntryBody = buildCostEntryBody;
function buildCostEntryListParams(o) {
    const params = {
        pageNum: (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000),
        pageSize: (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '20', '--page-size', 1, input_1.MAX_PAGE_SIZE),
        ...(0, exports.releaseParams)(o.release),
    };
    if (o.category !== undefined)
        params.category = (0, cliHelpers_1.requireOneOf)(o.category.trim().toLowerCase(), exports.COST_CATEGORIES, '--category');
    if (o.from !== undefined)
        params.from = (0, cliHelpers_1.parseDate)(o.from, '--from');
    if (o.to !== undefined)
        params.to = (0, cliHelpers_1.parseDate)(o.to, '--to');
    if (params.from && params.to && params.from > params.to) {
        throw new cliHelpers_1.InputError(`--from (${params.from}) 不能晚于 --to (${params.to})`);
    }
    return params;
}
exports.buildCostEntryListParams = buildCostEntryListParams;
//# sourceMappingURL=costInput.js.map