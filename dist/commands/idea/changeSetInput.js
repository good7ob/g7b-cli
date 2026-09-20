"use strict";
/**
 * CLI-boundary validation for `idea change-set` (ChangeSetCreateDto / ChangeSetUpdateDto /
 * ChangeSetItemDto / ChangeSetQueryDto / ChangeSetApplyDto). Limits mirror ChangeSetItemFields.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApplyBody = exports.buildItemUpdateBody = exports.buildItemAddBody = exports.buildListParams = exports.buildUpdateBody = exports.buildCreateBody = exports.CHANGE_SET_ERROR_CODES = exports.MAX_OBJECT_REF = exports.MAX_ITEM_DESCRIPTION = exports.MAX_CS_SUMMARY = exports.MAX_CS_TITLE = exports.CHANGE_KINDS = exports.OBJECT_TYPES = exports.CHANGE_SET_STATUSES = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("./input");
exports.CHANGE_SET_STATUSES = [
    'draft', 'impact_analyzed', 'pending_approval', 'approved', 'applied', 'rejected', 'cancelled',
];
exports.OBJECT_TYPES = ['PRD', 'FP', 'RP', 'UI', 'API', 'DB', 'ARCH', 'TEST_CASE', 'TASK', 'OTHER'];
exports.CHANGE_KINDS = ['add', 'update', 'remove'];
exports.MAX_CS_TITLE = 200;
exports.MAX_CS_SUMMARY = 2000;
exports.MAX_ITEM_DESCRIPTION = 1000;
exports.MAX_OBJECT_REF = 300;
exports.CHANGE_SET_ERROR_CODES = {
    1000: '缺少必填参数',
    1001: '参数值不合法（枚举 / 长度 / solutionId 不属于该 Idea / moduleId 不属于该产品）',
    1002: '变更集 / 条目 / Idea 不存在（或已删除）',
    1006: '数据已存在：同一变更集内该对象已有条目，或已有待处理的审批',
    1007: '当前状态不允许该操作（创建要求 Idea 为 approved/planning；改条目仅 draft/impact_analyzed；提交要求 impact_analyzed 且至少 1 个已确认条目；Apply 要求 approved 且未 Apply）',
    1009: '并发冲突（状态刚被他人改变），请重试',
    2000: '无权访问：你不是该产品的组织成员（Apply 另要求 owner/admin 或创建人）',
};
function buildCreateBody(ideaId, o) {
    const body = { ideaId, title: (0, cliHelpers_1.requireText)(o.title, exports.MAX_CS_TITLE, '--title') };
    if (o.solution !== undefined)
        body.solutionId = (0, cliHelpers_1.parseId)(o.solution, '--solution');
    if (o.summary !== undefined)
        body.summary = (0, cliHelpers_1.checkMaxLength)(o.summary, exports.MAX_CS_SUMMARY, '--summary');
    return body;
}
exports.buildCreateBody = buildCreateBody;
/** Omitted flag = unchanged (backend contract), so only send what was given. */
function buildUpdateBody(o) {
    const body = {};
    if (o.title !== undefined)
        body.title = (0, cliHelpers_1.requireText)(o.title, exports.MAX_CS_TITLE, '--title');
    if (o.summary !== undefined)
        body.summary = (0, cliHelpers_1.checkMaxLength)(o.summary, exports.MAX_CS_SUMMARY, '--summary');
    if (Object.keys(body).length === 0)
        throw new cliHelpers_1.InputError('没有要修改的字段：至少指定 --title / --summary 之一');
    return body;
}
exports.buildUpdateBody = buildUpdateBody;
/** The backend requires ideaId or productId; the CLI takes exactly one (product may come from GOOD7OB_PRODUCT_ID). */
function buildListParams(o) {
    if (o.idea !== undefined && o.product !== undefined)
        throw new cliHelpers_1.InputError('--idea 与 --product 只能二选一');
    const scope = o.idea !== undefined ? { ideaId: (0, cliHelpers_1.parseId)(o.idea, '--idea') } : { productId: (0, cliHelpers_1.resolveProductId)(o.product) };
    const params = {
        ...scope,
        pageNum: (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000),
        pageSize: (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '20', '--page-size', 1, input_1.MAX_PAGE_SIZE),
    };
    if (o.status !== undefined)
        params.status = (0, cliHelpers_1.requireOneOf)(o.status, exports.CHANGE_SET_STATUSES, '--status');
    return params;
}
exports.buildListParams = buildListParams;
/** Type is case-insensitive (the backend upper-cases it), kind likewise lower-cases. */
function applyItemFields(body, o) {
    if (o.type !== undefined)
        body.objectType = (0, cliHelpers_1.requireOneOf)(o.type.trim().toUpperCase(), exports.OBJECT_TYPES, '--type');
    if (o.kind !== undefined)
        body.changeKind = (0, cliHelpers_1.requireOneOf)(o.kind.trim().toLowerCase(), exports.CHANGE_KINDS, '--kind');
    if (o.description !== undefined)
        body.description = (0, cliHelpers_1.requireText)(o.description, exports.MAX_ITEM_DESCRIPTION, '--description');
    if (o.objectId !== undefined)
        body.objectId = (0, cliHelpers_1.parseId)(o.objectId, '--object-id');
    if (o.objectRef !== undefined)
        body.objectRef = (0, cliHelpers_1.requireText)(o.objectRef, exports.MAX_OBJECT_REF, '--object-ref');
}
/** type / kind / description are mandatory and at least one of object id / ref must locate the object. */
function buildItemAddBody(o) {
    const missing = ['type', 'kind', 'description'].filter((k) => o[k] === undefined);
    if (missing.length)
        throw new cliHelpers_1.InputError(`缺少必填参数: ${missing.map((k) => `--${k}`).join(' / ')}`);
    if (o.objectId === undefined && o.objectRef === undefined) {
        throw new cliHelpers_1.InputError('--object-id 与 --object-ref 至少提供一个（同时给出也可以）');
    }
    const body = {};
    applyItemFields(body, o);
    return body;
}
exports.buildItemAddBody = buildItemAddBody;
function buildItemUpdateBody(o) {
    const body = {};
    applyItemFields(body, o);
    if (Object.keys(body).length === 0) {
        throw new cliHelpers_1.InputError('没有要修改的字段：至少指定 --type / --kind / --description / --object-id / --object-ref 之一');
    }
    return body;
}
exports.buildItemUpdateBody = buildItemUpdateBody;
function buildApplyBody(o) {
    return o.module === undefined ? {} : { moduleId: (0, cliHelpers_1.parseId)(o.module, '--module') };
}
exports.buildApplyBody = buildApplyBody;
//# sourceMappingURL=changeSetInput.js.map