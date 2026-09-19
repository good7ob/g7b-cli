"use strict";
/**
 * CLI-boundary validation for `workspace queue` commands. Mirrors WorkspaceQueueService /
 * WorkQueueActionService (api-0089) so a bad value is rejected here with a clear message
 * instead of as a 1000/1001 round-trip.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildActionBody = exports.parseSnoozeUntil = exports.buildQueueParams = exports.ACTION_ERROR_CODES = exports.WORKSPACE_ERROR_CODES = exports.MAX_SNOOZE_DAYS = exports.MAX_QUEUE_LIMIT = exports.QUEUE_SORTS = exports.ACTION_TYPES = exports.QUEUE_STATUSES = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.QUEUE_STATUSES = ['active', 'snoozed', 'dismissed', 'done', 'all', 'new', 'in_progress', 'waiting'];
exports.ACTION_TYPES = [
    'PLAN_APPROVAL', 'COMPLETION_APPROVAL', 'INFO_REQUEST', 'BLOCKED', 'PAUSED', 'SYSTEM_ALERT',
    'REQUIREMENT_TRIAGE', 'APPROVAL', 'RISK_ALERT',
];
exports.QUEUE_SORTS = ['newest', 'score'];
exports.MAX_QUEUE_LIMIT = 200;
exports.MAX_SNOOZE_DAYS = 30;
const MINUTE_MS = 60000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Codes every workspace endpoint can answer with. 1002 also covers "not yours" (ids of others never leak). */
exports.WORKSPACE_ERROR_CODES = {
    400: '缺少用户身份（userId），请先运行 good7ob config set api-key <key>',
    1000: '缺少必填参数',
    1001: '参数值不合法',
    1002: '不存在（队列项不存在或不属于你 / 任务、产品不存在）',
    1007: '当前状态不支持该操作（例如对已完成 / 已忽略的队列项 dismiss 或 snooze）',
};
/** Extra meaning of the codes when deciding an item in place (`approve` / `reject`). */
exports.ACTION_ERROR_CODES = {
    ...exports.WORKSPACE_ERROR_CODES,
    1002: '不存在（队列项不存在或不属于你，或该任务已没有待审批的计划）',
    1007: '该队列项不能就地决定（类型没有就地审批，或已处理 / 已忽略 / 任务已不在待审批状态）—— 请到来源对象处理',
    1009: '已被他人处理（并发冲突），请用 good7ob workspace queue --status all 核对后再决定',
    2000: '无权限：审批需组织 owner/admin；任务计划 / 完成审批需任务责任人、创建人或 owner',
};
/** Case-insensitive enum flag: the backend folds case too; the CLI sends the canonical spelling. */
function enumFlag(raw, allowed, label, upper) {
    const value = upper ? raw.trim().toUpperCase() : raw.trim().toLowerCase();
    return (0, cliHelpers_1.requireOneOf)(value, allowed, label);
}
function buildQueueParams(o) {
    const params = {
        limit: (0, cliHelpers_1.parseIntInRange)(o.limit ?? '50', '--limit', 1, exports.MAX_QUEUE_LIMIT),
    };
    if (o.status !== undefined)
        params.status = enumFlag(o.status, exports.QUEUE_STATUSES, '--status', false);
    if (o.actionType !== undefined)
        params.actionType = enumFlag(o.actionType, exports.ACTION_TYPES, '--action-type', true);
    if (o.product !== undefined)
        params.productId = (0, cliHelpers_1.parseId)(o.product, '--product');
    if (o.sort !== undefined)
        params.sort = enumFlag(o.sort, exports.QUEUE_SORTS, '--sort', false);
    return params;
}
exports.buildQueueParams = buildQueueParams;
const UNTIL_HINT = '（ISO 日期时间如 2026-09-20T09:00:00Z / 2026-09-20T17:00:00+08:00，无时区按 UTC；或相对时间 +30m / +2h / +1d）';
const RELATIVE = /^\+(\d{1,6})([mhd])$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/;
const UNIT_MS = { m: MINUTE_MS, h: 60 * MINUTE_MS, d: DAY_MS };
/** Wall-clock parts of an ISO string -> epoch ms, or null when any part is not a real value. */
function isoToEpoch(m) {
    const [y, mo, d, h, mi, s] = m.slice(1, 7).map((p) => Number(p ?? 0));
    const day = new Date(Date.UTC(y, mo - 1, d));
    const realDay = day.getUTCFullYear() === y && day.getUTCMonth() === mo - 1 && day.getUTCDate() === d;
    if (!realDay || h > 23 || mi > 59 || s > 59)
        return null;
    let offsetMin = 0;
    if (m[7] && m[7] !== 'Z') {
        const oh = Number(m[7].slice(1, 3));
        const om = Number(m[7].slice(4, 6));
        if (oh > 18 || om > 59)
            return null;
        offsetMin = (m[7][0] === '-' ? -1 : 1) * (oh * 60 + om);
    }
    return Date.UTC(y, mo - 1, d, h, mi, s) - offsetMin * MINUTE_MS;
}
/**
 * `--until` -> the UTC instant the backend expects (`yyyy-MM-ddTHH:mm:ssZ`). Accepts an ISO
 * date-time (no offset = UTC, as the backend reads it) or `+<n>m|h|d` relative to `now`.
 * Rejects what the backend would (not in the future, more than 30 days ahead) up front.
 */
function parseSnoozeUntil(raw, now = new Date()) {
    const text = raw?.trim();
    if (!text)
        throw new cliHelpers_1.InputError(`--until 不能为空${UNTIL_HINT}`);
    const rel = RELATIVE.exec(text);
    const iso = rel ? null : ISO.exec(text);
    const at = rel ? now.getTime() + Number(rel[1]) * UNIT_MS[rel[2]] : iso ? isoToEpoch(iso) : null;
    if (at === null || (rel && Number(rel[1]) === 0)) {
        throw new cliHelpers_1.InputError(`--until 不是有效的时间: ${text}${UNTIL_HINT}`);
    }
    const until = new Date(Math.floor(at / 1000) * 1000);
    if (until.getTime() <= now.getTime())
        throw new cliHelpers_1.InputError(`--until 必须晚于当前时间，收到: ${text}`);
    if (until.getTime() - now.getTime() > exports.MAX_SNOOZE_DAYS * DAY_MS) {
        throw new cliHelpers_1.InputError(`--until 最多只能稍后 ${exports.MAX_SNOOZE_DAYS} 天，收到: ${text}`);
    }
    return until.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
exports.parseSnoozeUntil = parseSnoozeUntil;
/** approve: comment optional (the backend records it for APPROVAL items only). reject: required, non-blank. */
function buildActionBody(action, comment) {
    const hasComment = comment !== undefined && comment.trim() !== '';
    if (action === 'reject' && !hasComment) {
        throw new cliHelpers_1.InputError('--comment 不能为空（驳回必须说明原因）');
    }
    return hasComment ? { action, comment } : { action };
}
exports.buildActionBody = buildActionBody;
//# sourceMappingURL=input.js.map