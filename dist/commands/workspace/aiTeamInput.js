"use strict";
/**
 * CLI-boundary validation for the B2 workspace commands: `ai-team`, `ai-team log`, `daily-report`,
 * `next-actions` (api-0089 §7-§9; WorkspaceAiTeamService, WorkspaceAiWorkLogService,
 * WorkspaceDailyReportService, WorkspaceNextActionService). The backend clamps paging silently; the CLI
 * refuses out-of-range values instead, so a typo is not mistaken for a result.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildNextActionsParams = exports.buildDailyReportBody = exports.buildDailyReportParams = exports.parseReportDate = exports.buildWorkLogParams = exports.buildAiTeamParams = exports.MAX_NEXT_ACTIONS = exports.MAX_LOG_RANGE_DAYS = exports.MAX_LOG_PAGE_SIZE = exports.AI_TEAM_STATUSES = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.AI_TEAM_STATUSES = ['working', 'waiting', 'error', 'idle', 'all'];
exports.MAX_LOG_PAGE_SIZE = 100;
exports.MAX_LOG_RANGE_DAYS = 31;
exports.MAX_NEXT_ACTIONS = 20;
const DAY_MS = 86400000;
const END_OF_DAY_MS = DAY_MS - 1;
/** `yyyy-MM-dd` (whole day) or `yyyy-MM-ddTHH:mm[:ss]` (server local time, no zone) — what the work-log accepts. */
const BOUND = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?$/;
function buildAiTeamParams(o) {
    const params = {};
    if (o.status !== undefined)
        params.status = (0, cliHelpers_1.requireOneOf)(o.status.trim().toLowerCase(), exports.AI_TEAM_STATUSES, '--status');
    if (o.org !== undefined)
        params.orgId = (0, cliHelpers_1.parseId)(o.org, '--org');
    return params;
}
exports.buildAiTeamParams = buildAiTeamParams;
/** A work-log bound as sent + its wall-clock ms; a date-only `to` means the end of that day, as the backend reads it. */
function parseBound(raw, label, endOfDay) {
    const text = raw.trim();
    const m = BOUND.exec(text);
    const [, day, h, mi, s] = m ?? [];
    if (!m || Number(h ?? 0) > 23 || Number(mi ?? 0) > 59 || Number(s ?? 0) > 59) {
        throw new cliHelpers_1.InputError(`${label} 必须是 yyyy-MM-dd 或 yyyy-MM-ddTHH:mm[:ss]（无时区）的有效时间，收到: ${raw}`);
    }
    (0, cliHelpers_1.parseDate)(day, label);
    const dayMs = Date.parse(day);
    const ms = h === undefined ? dayMs + (endOfDay ? END_OF_DAY_MS : 0) : dayMs + Number(h) * 3600000 + Number(mi) * 60000 + Number(s ?? 0) * 1000;
    return { text, ms };
}
/** Range at most 31 days (checked when both ends are given; with only one end the backend defaults the other). */
function buildWorkLogParams(o) {
    const from = o.from === undefined ? undefined : parseBound(o.from, '--from', false);
    const to = o.to === undefined ? undefined : parseBound(o.to, '--to', true);
    if (from && to) {
        if (from.ms > to.ms)
            throw new cliHelpers_1.InputError(`--from (${from.text}) 不能晚于 --to (${to.text})`);
        if (to.ms - from.ms > exports.MAX_LOG_RANGE_DAYS * DAY_MS) {
            throw new cliHelpers_1.InputError(`--from 到 --to 的范围最多 ${exports.MAX_LOG_RANGE_DAYS} 天，收到: ${from.text} → ${to.text}`);
        }
    }
    return {
        ...(from ? { from: from.text } : {}),
        ...(to ? { to: to.text } : {}),
        pageNum: (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000),
        pageSize: (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '20', '--page-size', 1, exports.MAX_LOG_PAGE_SIZE),
    };
}
exports.buildWorkLogParams = buildWorkLogParams;
/**
 * Report day: a real date, never in the future. The server judges "today" in its own zone, so the CLI
 * only refuses a day that is later than tomorrow in UTC (no zone is that far ahead); the server decides the edge.
 */
function parseReportDate(raw, now = new Date()) {
    const date = (0, cliHelpers_1.parseDate)(raw.trim(), '--date');
    const latest = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
    if (date > latest)
        throw new cliHelpers_1.InputError(`--date 不能晚于今天，收到: ${raw}`);
    return date;
}
exports.parseReportDate = parseReportDate;
const buildDailyReportParams = (o) => o.date === undefined ? {} : { date: parseReportDate(o.date) };
exports.buildDailyReportParams = buildDailyReportParams;
/** `useAi` is only sent when asked for (the backend default is a deterministic report). */
function buildDailyReportBody(o) {
    return { ...(0, exports.buildDailyReportParams)(o), ...(o.ai ? { useAi: true } : {}) };
}
exports.buildDailyReportBody = buildDailyReportBody;
const buildNextActionsParams = (o) => ({
    limit: (0, cliHelpers_1.parseIntInRange)(o.limit ?? '5', '--limit', 1, exports.MAX_NEXT_ACTIONS),
});
exports.buildNextActionsParams = buildNextActionsParams;
//# sourceMappingURL=aiTeamInput.js.map