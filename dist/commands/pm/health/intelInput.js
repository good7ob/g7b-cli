"use strict";
/**
 * CLI-boundary validation for the C2 what-if / explain / management-report commands (backend
 * WhatIfService, ProgressExplainService, ReportPeriod, ManagementReportService — api-0090 §11-§13).
 * Limits mirror the backend so a bad value is rejected here instead of as a 1001 round-trip.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOutPath = exports.buildReportListParams = exports.buildReportBody = exports.buildExplainBody = exports.buildWhatIfBody = exports.parseBounded = exports.MAX_REPORT_DAYS = exports.PERIOD_TYPES = exports.MAX_DEADLINE = exports.MAX_MULTIPLIER = exports.MIN_MULTIPLIER = exports.MAX_EXTRA_CAPACITY = exports.MAX_SCOPE = exports.MAX_QUESTION = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const cliHelpers_1 = require("../../../utils/cliHelpers");
const input_1 = require("./input");
const costInput_1 = require("./costInput");
exports.MAX_QUESTION = 500;
exports.MAX_SCOPE = 1e9;
exports.MAX_EXTRA_CAPACITY = 1e6;
exports.MIN_MULTIPLIER = 0.1;
exports.MAX_MULTIPLIER = 10;
exports.MAX_DEADLINE = '2100-01-01';
exports.PERIOD_TYPES = ['week', 'month', 'custom'];
/** Longest custom report period, both end days counted. */
exports.MAX_REPORT_DAYS = 92;
const DAY_MS = 86400000;
const DECIMAL = /^[0-9]+(\.[0-9]+)?$/;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
/** A non-negative decimal within [min, max]. */
function parseBounded(raw, label, min, max) {
    const text = raw?.trim();
    if (text === undefined || !DECIMAL.test(text)) {
        throw new cliHelpers_1.InputError(`${label} 必须是数字（${min} 到 ${max}），收到: ${raw ?? '(空)'}`);
    }
    const value = Number(text);
    if (value < min || value > max)
        throw new cliHelpers_1.InputError(`${label} 必须在 ${min} 到 ${max} 之间，收到: ${raw}`);
    return value;
}
exports.parseBounded = parseBounded;
/** Every field is optional (no flag at all = "scenario equals baseline", which the backend answers with a warning). */
function buildWhatIfBody(o) {
    const body = { ...(0, costInput_1.releaseParams)(o.release) };
    if (o.addScope !== undefined)
        body.addScope = parseBounded(o.addScope, '--add-scope', 0, exports.MAX_SCOPE);
    if (o.removeScope !== undefined)
        body.removeScope = parseBounded(o.removeScope, '--remove-scope', 0, exports.MAX_SCOPE);
    if (o.velocityMultiplier !== undefined) {
        body.velocityMultiplier = parseBounded(o.velocityMultiplier, '--velocity-multiplier', exports.MIN_MULTIPLIER, exports.MAX_MULTIPLIER);
    }
    if (o.extraCapacity !== undefined)
        body.extraWeeklyCapacity = parseBounded(o.extraCapacity, '--extra-capacity', 0, exports.MAX_EXTRA_CAPACITY);
    if (o.deadline !== undefined) {
        const deadline = (0, cliHelpers_1.parseDate)(o.deadline, '--deadline');
        if (deadline < costInput_1.MIN_ENTRY_DATE || deadline > exports.MAX_DEADLINE) {
            throw new cliHelpers_1.InputError(`--deadline 必须在 ${costInput_1.MIN_ENTRY_DATE} 到 ${exports.MAX_DEADLINE} 之间，收到: ${o.deadline}`);
        }
        body.deadline = deadline;
    }
    return body;
}
exports.buildWhatIfBody = buildWhatIfBody;
/** A blank question counts as "no question" (the backend then asks its default one). */
function buildExplainBody(o) {
    const question = o.question?.trim();
    return {
        ...(0, costInput_1.releaseParams)(o.release),
        ...(question ? { question: (0, cliHelpers_1.checkMaxLength)(question, exports.MAX_QUESTION, '--question') } : {}),
    };
}
exports.buildExplainBody = buildExplainBody;
/** Monday of the week containing `day` (ISO weeks, as VelocityCalculator.weekStart). */
function weekStart(day) {
    const ms = Date.parse(day);
    return isoDay(ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS);
}
function checkCustomPeriod(from, to, today) {
    if (!from || !to)
        throw new cliHelpers_1.InputError('--period custom 必须同时给出 --from 和 --to');
    if (from > to)
        throw new cliHelpers_1.InputError(`--from (${from}) 不能晚于 --to (${to})`);
    if (to > today)
        throw new cliHelpers_1.InputError(`--to 不能晚于今天（UTC ${today}），收到: ${to}`);
    if (from < costInput_1.MIN_ENTRY_DATE)
        throw new cliHelpers_1.InputError(`--from 不能早于 ${costInput_1.MIN_ENTRY_DATE}，收到: ${from}`);
    const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
    if (days > exports.MAX_REPORT_DAYS)
        throw new cliHelpers_1.InputError(`自定义报告期最长 ${exports.MAX_REPORT_DAYS} 天（含首尾），当前 ${days} 天`);
}
function checkCalendarPeriod(period, from, to, today) {
    if (to !== undefined) {
        throw new cliHelpers_1.InputError('--to 只用于 --period custom（week / month 用 --from 指定其所在的周 / 月，缺省为上一个完整周 / 月）');
    }
    if (from === undefined)
        return;
    const start = period === 'week' ? weekStart(from) : `${from.slice(0, 8)}01`;
    if (start > today)
        throw new cliHelpers_1.InputError(`报告期不能在未来：${from} 所在${period === 'week' ? '周' : '月'}从 ${start} 开始，今天（UTC）是 ${today}`);
    if (start < costInput_1.MIN_ENTRY_DATE)
        throw new cliHelpers_1.InputError(`--from 所在${period === 'week' ? '周' : '月'}不能早于 ${costInput_1.MIN_ENTRY_DATE}，收到: ${from}`);
}
/** `POST …/reports/management` body; `useAi` is only sent when asked for. */
function buildReportBody(o, now = new Date()) {
    if (o.period === undefined)
        throw new cliHelpers_1.InputError(`--period 必填（${exports.PERIOD_TYPES.join(' | ')}）`);
    const period = (0, cliHelpers_1.requireOneOf)(o.period.trim().toLowerCase(), exports.PERIOD_TYPES, '--period');
    const from = o.from === undefined ? undefined : (0, cliHelpers_1.parseDate)(o.from, '--from');
    const to = o.to === undefined ? undefined : (0, cliHelpers_1.parseDate)(o.to, '--to');
    const today = isoDay(now.getTime());
    if (period === 'custom')
        checkCustomPeriod(from, to, today);
    else
        checkCalendarPeriod(period, from, to, today);
    return {
        periodType: period,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(o.release !== undefined ? { releaseId: (0, cliHelpers_1.parseId)(o.release, '--release') } : {}),
        ...(o.ai ? { useAi: true } : {}),
    };
}
exports.buildReportBody = buildReportBody;
function buildReportListParams(o) {
    const params = {
        pageNum: (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000),
        pageSize: (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '20', '--page-size', 1, input_1.MAX_PAGE_SIZE),
        ...(0, costInput_1.releaseParams)(o.release),
    };
    if (o.period !== undefined)
        params.periodType = (0, cliHelpers_1.requireOneOf)(o.period.trim().toLowerCase(), exports.PERIOD_TYPES, '--period');
    return params;
}
exports.buildReportListParams = buildReportListParams;
/** `--out`: an absolute file path whose directory exists (checked before any HTTP call, so no report is generated for nothing). */
function resolveOutPath(raw) {
    if (raw === undefined)
        return undefined;
    if (!raw.trim())
        throw new cliHelpers_1.InputError('--out 不能为空');
    const file = path.resolve(raw.trim());
    const dir = path.dirname(file);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
        throw new cliHelpers_1.InputError(`--out 的目录不存在: ${dir}`);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory())
        throw new cliHelpers_1.InputError(`--out 是一个目录，需要文件路径: ${file}`);
    return file;
}
exports.resolveOutPath = resolveOutPath;
//# sourceMappingURL=intelInput.js.map