"use strict";
/**
 * CLI-boundary validation for `idea` commands. Limits mirror the backend DTOs
 * (IdeaCreateDto / IdeaUpdateDto / IdeaSolution*Dto) so a bad value is rejected
 * here with a clear message instead of as a 1001 round-trip.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSelectBody = exports.parseRejectedReason = exports.buildReasonBody = exports.parseTransition = exports.buildUpdateBody = exports.buildCreateBody = exports.buildListParams = exports.IDEA_ERROR_CODES = exports.MAX_TAG_LENGTH = exports.MAX_PAGE_SIZE = exports.MAX_REASON = exports.MAX_EXPECTED_VALUE = exports.MAX_TITLE = exports.TRANSITIONS = exports.STATUSES = exports.PRIORITIES = exports.SOURCES = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.SOURCES = [
    'customer', 'feedback', 'pm', 'dev', 'ai', 'ops', 'bug', 'competitor', 'market', 'management',
];
exports.PRIORITIES = ['low', 'medium', 'high'];
exports.STATUSES = [
    'draft', 'evaluating', 'approved', 'rejected', 'archived', 'planning', 'developing', 'released', 'validated',
];
/** approved / rejected are only reachable through `idea select` / `idea reject`. */
exports.TRANSITIONS = ['evaluating', 'archived', 'planning', 'developing', 'released', 'validated'];
exports.MAX_TITLE = 200;
exports.MAX_EXPECTED_VALUE = 500;
exports.MAX_REASON = 1000;
exports.MAX_PAGE_SIZE = 100;
exports.MAX_TAG_LENGTH = 30;
exports.IDEA_ERROR_CODES = {
    1000: '缺少必填参数',
    1001: '参数值不合法',
    1002: 'Idea / 方案不存在（或已删除）',
    1006: '数据已存在：关联重复，或该 Idea 已有待审批的决策（审批完成前不能再次选定 / 发起审批 / 合并）',
    1007: '当前状态不允许该操作（非法状态流转、字段已锁定、附件已达 20 个上限、合并 / 恢复条件不满足；选定方案要求 Idea 处于 evaluating 且尚未生成需求）',
    1008: '缺少 id',
    1009: '并发冲突（其他人刚刚修改了它），请重试',
    2000: '无权访问：你不是该 Idea 所属产品的组织成员',
};
/** Raw commander options -> validated request pieces. All throw before any HTTP call. */
function buildListParams(o) {
    const params = {
        productId: (0, cliHelpers_1.resolveProductId)(o.product),
        pageNum: (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000),
        pageSize: (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '20', '--page-size', 1, exports.MAX_PAGE_SIZE),
    };
    if (o.status !== undefined)
        params.status = (0, cliHelpers_1.requireOneOf)(o.status, exports.STATUSES, '--status');
    if (o.keyword)
        params.keyword = o.keyword;
    if (o.tag !== undefined)
        params.tag = (0, cliHelpers_1.requireText)(o.tag, exports.MAX_TAG_LENGTH, '--tag');
    if (o.release !== undefined)
        params.releaseId = (0, cliHelpers_1.parseId)(o.release, '--release');
    return params;
}
exports.buildListParams = buildListParams;
function applyOptionalIdeaFields(body, o) {
    if (o.source !== undefined)
        body.source = (0, cliHelpers_1.requireOneOf)(o.source, exports.SOURCES, '--source');
    if (o.priority !== undefined)
        body.priority = (0, cliHelpers_1.requireOneOf)(o.priority, exports.PRIORITIES, '--priority');
    if (o.description !== undefined)
        body.description = o.description;
    if (o.expectedValue !== undefined)
        body.expectedValue = (0, cliHelpers_1.checkMaxLength)(o.expectedValue, exports.MAX_EXPECTED_VALUE, '--expected-value');
}
function buildCreateBody(o) {
    const body = {
        productId: (0, cliHelpers_1.resolveProductId)(o.product),
        title: (0, cliHelpers_1.requireText)(o.title, exports.MAX_TITLE, '--title'),
        source: (0, cliHelpers_1.requireOneOf)(o.source ?? '', exports.SOURCES, '--source'),
    };
    applyOptionalIdeaFields(body, o);
    return body;
}
exports.buildCreateBody = buildCreateBody;
/** Omitted flag = field unchanged (backend contract), so only send what was given. */
function buildUpdateBody(o) {
    const body = {};
    if (o.title !== undefined)
        body.title = (0, cliHelpers_1.requireText)(o.title, exports.MAX_TITLE, '--title');
    applyOptionalIdeaFields(body, o);
    if (o.release !== undefined && o.clearRelease)
        throw new cliHelpers_1.InputError('--release 与 --clear-release 不能同时使用');
    if (o.release !== undefined)
        body.releaseId = (0, cliHelpers_1.parseId)(o.release, '--release');
    if (o.clearRelease)
        body.clearRelease = true;
    if (Object.keys(body).length === 0) {
        throw new cliHelpers_1.InputError('没有要修改的字段：至少指定 --title / --description / --source / --priority / --expected-value / --release / --clear-release 之一');
    }
    return body;
}
exports.buildUpdateBody = buildUpdateBody;
/** approved / rejected get a pointer to the command that does reach them. */
function parseTransition(raw) {
    try {
        return (0, cliHelpers_1.requireOneOf)(raw, exports.TRANSITIONS, 'toStatus');
    }
    catch (error) {
        if (raw === 'approved' || raw === 'rejected') {
            throw new cliHelpers_1.InputError(`${error.message}；approved 只能用 idea select，rejected 只能用 idea reject`);
        }
        throw error;
    }
}
exports.parseTransition = parseTransition;
function buildReasonBody(field, raw) {
    return { [field]: (0, cliHelpers_1.requireText)(raw, exports.MAX_REASON, '--reason') };
}
exports.buildReasonBody = buildReasonBody;
/** `<solutionId>:<text>` (split on the first colon) -> {solutionId, reason}. */
function parseRejectedReason(raw) {
    const at = raw.indexOf(':');
    if (at < 0)
        throw new cliHelpers_1.InputError(`--rejected-reason 格式为 <solutionId>:<原因>，收到: ${raw}`);
    return {
        solutionId: (0, cliHelpers_1.parseId)(raw.slice(0, at), '--rejected-reason 的 solutionId'),
        reason: (0, cliHelpers_1.requireText)(raw.slice(at + 1), exports.MAX_REASON, '--rejected-reason 的原因'),
    };
}
exports.parseRejectedReason = parseRejectedReason;
/** Body of POST .../select. Without the new options it is exactly the MVP body {decisionReason}. */
function buildSelectBody(solutionId, o) {
    const body = { ...buildReasonBody('decisionReason', o.reason) };
    if (o.rejectedReason?.length) {
        const rejected = o.rejectedReason.map(parseRejectedReason);
        const ids = rejected.map((r) => r.solutionId);
        if (ids.includes(solutionId))
            throw new cliHelpers_1.InputError('--rejected-reason 不能包含被选定的方案本身');
        if (new Set(ids).size !== ids.length)
            throw new cliHelpers_1.InputError('--rejected-reason 的 solutionId 不能重复');
        body.rejectedReasons = rejected;
    }
    if (o.requireApproval)
        body.requireApproval = true;
    return body;
}
exports.buildSelectBody = buildSelectBody;
//# sourceMappingURL=input.js.map