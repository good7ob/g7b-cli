"use strict";
/**
 * CLI-boundary validation for `idea` commands. Limits mirror the backend DTOs
 * (IdeaCreateDto / IdeaUpdateDto / IdeaSolution*Dto) so a bad value is rejected
 * here with a clear message instead of as a 1001 round-trip.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReasonBody = exports.buildSolutionUpdateBody = exports.buildSolutionCreateBody = exports.buildUpdateBody = exports.buildCreateBody = exports.buildListParams = exports.resolveProductId = exports.IDEA_ERROR_CODES = exports.MAX_PAGE_SIZE = exports.MAX_REASON = exports.MAX_SOLUTION_NOTE = exports.MAX_SOLUTION_NAME = exports.MAX_EXPECTED_VALUE = exports.MAX_TITLE = exports.TRANSITIONS = exports.STATUSES = exports.PRIORITIES = exports.SOURCES = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.SOURCES = [
    'customer', 'feedback', 'pm', 'dev', 'ai', 'ops', 'bug', 'competitor', 'market', 'management',
];
exports.PRIORITIES = ['low', 'medium', 'high'];
exports.STATUSES = ['draft', 'evaluating', 'approved', 'rejected', 'archived'];
exports.TRANSITIONS = ['evaluating', 'archived'];
exports.MAX_TITLE = 200;
exports.MAX_EXPECTED_VALUE = 500;
exports.MAX_SOLUTION_NAME = 200;
exports.MAX_SOLUTION_NOTE = 500;
exports.MAX_REASON = 1000;
exports.MAX_PAGE_SIZE = 100;
exports.IDEA_ERROR_CODES = {
    1000: '缺少必填参数',
    1001: '参数值不合法',
    1002: 'Idea / 方案不存在（或已删除）',
    1007: '当前状态不允许该操作（已批准/已归档的 Idea 不可修改；选定方案要求 Idea 处于 evaluating 且尚未生成需求）',
    1009: '并发冲突（其他人刚刚修改了它），请重试',
    2000: '无权访问：你不是该 Idea 所属产品的组织成员',
};
/** Raw commander options -> validated request pieces. All throw before any HTTP call. */
function resolveProductId(raw) {
    const value = raw ?? process.env.GOOD7OB_PRODUCT_ID;
    if (value === undefined) {
        throw new cliHelpers_1.InputError('缺少产品 ID。用 --product <id> 指定，或设置环境变量 GOOD7OB_PRODUCT_ID。');
    }
    return (0, cliHelpers_1.parseId)(value, '--product');
}
exports.resolveProductId = resolveProductId;
function buildListParams(o) {
    const params = {
        productId: resolveProductId(o.product),
        pageNum: (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000),
        pageSize: (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '20', '--page-size', 1, exports.MAX_PAGE_SIZE),
    };
    if (o.status !== undefined)
        params.status = (0, cliHelpers_1.requireOneOf)(o.status, exports.STATUSES, '--status');
    if (o.keyword)
        params.keyword = o.keyword;
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
        productId: resolveProductId(o.product),
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
    if (Object.keys(body).length === 0) {
        throw new cliHelpers_1.InputError('没有要修改的字段：至少指定 --title / --description / --source / --priority / --expected-value 之一');
    }
    return body;
}
exports.buildUpdateBody = buildUpdateBody;
function applySolutionNotes(body, o) {
    if (o.description !== undefined)
        body.description = o.description;
    if (o.costNote !== undefined)
        body.costNote = (0, cliHelpers_1.checkMaxLength)(o.costNote, exports.MAX_SOLUTION_NOTE, '--cost-note');
    if (o.cycleNote !== undefined)
        body.cycleNote = (0, cliHelpers_1.checkMaxLength)(o.cycleNote, exports.MAX_SOLUTION_NOTE, '--cycle-note');
    if (o.effectNote !== undefined)
        body.expectedEffectNote = (0, cliHelpers_1.checkMaxLength)(o.effectNote, exports.MAX_SOLUTION_NOTE, '--effect-note');
}
function buildSolutionCreateBody(o) {
    const body = { name: (0, cliHelpers_1.requireText)(o.name, exports.MAX_SOLUTION_NAME, '--name') };
    applySolutionNotes(body, o);
    return body;
}
exports.buildSolutionCreateBody = buildSolutionCreateBody;
function buildSolutionUpdateBody(o) {
    const body = {};
    if (o.name !== undefined)
        body.name = (0, cliHelpers_1.requireText)(o.name, exports.MAX_SOLUTION_NAME, '--name');
    applySolutionNotes(body, o);
    if (Object.keys(body).length === 0) {
        throw new cliHelpers_1.InputError('没有要修改的字段：至少指定 --name / --description / --cost-note / --cycle-note / --effect-note 之一');
    }
    return body;
}
exports.buildSolutionUpdateBody = buildSolutionUpdateBody;
function buildReasonBody(field, raw) {
    return { [field]: (0, cliHelpers_1.requireText)(raw, exports.MAX_REASON, '--reason') };
}
exports.buildReasonBody = buildReasonBody;
//# sourceMappingURL=input.js.map