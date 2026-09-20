"use strict";
/**
 * CLI-boundary validation for the C1 progress commands (config, scope changes, burnup,
 * snapshot rebuild, release baseline). Limits mirror the backend (ProgressConfigService,
 * ScopeChangeService, BurnupService, ProgressSnapshotService) so a bad value is rejected here
 * with a clear message instead of as a 1001 round-trip.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildNoteBody = exports.rebuildUrl = exports.buildBurnupParams = exports.buildAnnotateBody = exports.buildScopeChangeBody = exports.parseDelta = exports.buildScopeChangesParams = exports.buildConfigBody = exports.parseStatusCompletion = exports.MAX_BURNUP_SPAN_DAYS = exports.MAX_REBUILD_DAYS = exports.MAX_PAGE_SIZE = exports.MAX_NOTE = exports.MAX_REASON = exports.OVERRIDABLE_STATUSES = exports.WEIGHT_BASES = exports.PROGRESS_ERROR_CODES = void 0;
const cliHelpers_1 = require("../../../utils/cliHelpers");
/** The NEW endpoints (Result envelope). The old /health* ones keep the 40xxx codes. */
exports.PROGRESS_ERROR_CODES = {
    1000: '缺少必填参数',
    1001: '参数值不合法（口径/状态名/完成度范围、days 越界、日期倒置或跨度 > 366 天、Release 不属于该产品、reason/note 超长、deltaScope 为 0 等）',
    1002: '产品 / Release / 范围变更记录不存在（或已删除）',
    1008: '缺少 Release id',
    2000: '无权限：不是该产品所属组织的成员（写配置 / 重建快照需要组织 owner/admin）',
};
exports.WEIGHT_BASES = ['ESTIMATED_HOURS', 'STORY_POINT', 'WEIGHT'];
/** Statuses whose completion can be overridden; completed (always 100) and cancelled (out of scope) cannot. */
exports.OVERRIDABLE_STATUSES = [
    'not_started', 'pending_agent', 'pending_info', 'awaiting_plan_approval', 'in_progress', 'paused',
    'awaiting_completion_approval', 'blocked',
];
exports.MAX_REASON = 500;
exports.MAX_NOTE = 500;
exports.MAX_PAGE_SIZE = 100;
exports.MAX_REBUILD_DAYS = 90;
exports.MAX_BURNUP_SPAN_DAYS = 366;
/** The backend rejects |delta| < 0.005 (rounding noise) and >= 1e10 (NUMERIC(12,2)). */
const MIN_DELTA = 0.005;
const MAX_DELTA = 1e10;
/** `in_progress=30,blocked=50` -> { in_progress: 30, blocked: 50 }. */
function parseStatusCompletion(raw) {
    const result = {};
    for (const part of raw.split(',')) {
        const [key, value, ...extra] = part.split('=').map((s) => s.trim());
        if (!key || value === undefined || !value || extra.length) {
            throw new cliHelpers_1.InputError(`--status-completion 每一项须形如 状态=完成度（如 in_progress=30,blocked=50），收到: "${part.trim()}"`);
        }
        const status = key.toLowerCase();
        if (status === 'completed' || status === 'cancelled') {
            throw new cliHelpers_1.InputError(`--status-completion 不能覆盖 ${status}：completed 恒为 100，cancelled 不计入范围`);
        }
        (0, cliHelpers_1.requireOneOf)(status, exports.OVERRIDABLE_STATUSES, '--status-completion 的状态');
        if (status in result)
            throw new cliHelpers_1.InputError(`--status-completion 里 ${status} 重复出现`);
        if (!/^[0-9]+(\.[0-9]+)?$/.test(value) || Number(value) > 100) {
            throw new cliHelpers_1.InputError(`--status-completion 里 ${status} 的完成度必须是 0 到 100 的数字，收到: ${value}`);
        }
        result[status] = Number(value);
    }
    return result;
}
exports.parseStatusCompletion = parseStatusCompletion;
/** PUT replaces the whole config: omitting --status-completion clears any existing overrides. */
function buildConfigBody(o) {
    if (o.basis === undefined)
        throw new cliHelpers_1.InputError('--basis 必填（ESTIMATED_HOURS | STORY_POINT | WEIGHT）');
    const body = {
        weightBasis: (0, cliHelpers_1.requireOneOf)(o.basis.trim().toUpperCase(), exports.WEIGHT_BASES, '--basis'),
    };
    if (o.statusCompletion !== undefined)
        body.statusCompletion = parseStatusCompletion(o.statusCompletion);
    return body;
}
exports.buildConfigBody = buildConfigBody;
function buildScopeChangesParams(o) {
    const params = {
        pageNum: (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000),
        pageSize: (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '20', '--page-size', 1, exports.MAX_PAGE_SIZE),
    };
    if (o.release !== undefined)
        params.releaseId = (0, cliHelpers_1.parseId)(o.release, '--release');
    return params;
}
exports.buildScopeChangesParams = buildScopeChangesParams;
function parseDelta(raw) {
    if (raw === undefined || !/^[+-]?[0-9]+(\.[0-9]+)?$/.test(raw.trim())) {
        throw new cliHelpers_1.InputError(`--delta 必须是带符号的数字（如 30 或 -12.5），收到: ${raw ?? '(空)'}`);
    }
    const delta = Number(raw.trim());
    if (Math.abs(delta) < MIN_DELTA || Math.abs(delta) >= MAX_DELTA) {
        throw new cliHelpers_1.InputError(`--delta 必须非零且绝对值小于 10^10（至少 ${MIN_DELTA}），收到: ${raw}`);
    }
    return delta;
}
exports.parseDelta = parseDelta;
function buildScopeChangeBody(o) {
    const body = {
        deltaScope: parseDelta(o.delta),
        reason: (0, cliHelpers_1.requireText)(o.reason?.trim(), exports.MAX_REASON, '--reason'),
    };
    if (o.release !== undefined)
        body.releaseId = (0, cliHelpers_1.parseId)(o.release, '--release');
    return body;
}
exports.buildScopeChangeBody = buildScopeChangeBody;
function buildAnnotateBody(reason) {
    return { reason: (0, cliHelpers_1.requireText)(reason?.trim(), exports.MAX_REASON, '--reason') };
}
exports.buildAnnotateBody = buildAnnotateBody;
const DAY_MS = 86400000;
function buildBurnupParams(o) {
    const params = {};
    if (o.from !== undefined)
        params.from = (0, cliHelpers_1.parseDate)(o.from, '--from');
    if (o.to !== undefined)
        params.to = (0, cliHelpers_1.parseDate)(o.to, '--to');
    if (o.release !== undefined)
        params.releaseId = (0, cliHelpers_1.parseId)(o.release, '--release');
    if (params.from && params.to) {
        const span = (Date.parse(String(params.to)) - Date.parse(String(params.from))) / DAY_MS;
        if (span < 0)
            throw new cliHelpers_1.InputError(`--from (${params.from}) 不能晚于 --to (${params.to})`);
        if (span > exports.MAX_BURNUP_SPAN_DAYS)
            throw new cliHelpers_1.InputError(`--from 到 --to 的跨度最多 ${exports.MAX_BURNUP_SPAN_DAYS} 天，当前 ${span} 天`);
    }
    return params;
}
exports.buildBurnupParams = buildBurnupParams;
/** `/snapshots/rebuild?days=N`, or no query at all (the backend defaults to 30). */
function rebuildUrl(productId, days) {
    const base = `/progress/products/${productId}/snapshots/rebuild`;
    return days === undefined ? base : `${base}?days=${(0, cliHelpers_1.parseIntInRange)(days, '--days', 1, exports.MAX_REBUILD_DAYS)}`;
}
exports.rebuildUrl = rebuildUrl;
/** Optional note; blank counts as "no note" (the backend trims it the same way). */
function buildNoteBody(note) {
    const trimmed = note?.trim();
    return trimmed ? { note: (0, cliHelpers_1.checkMaxLength)(trimmed, exports.MAX_NOTE, '--note') } : {};
}
exports.buildNoteBody = buildNoteBody;
//# sourceMappingURL=input.js.map