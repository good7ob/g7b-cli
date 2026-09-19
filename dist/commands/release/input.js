"use strict";
/**
 * CLI-boundary validation for `release` commands. Limits mirror ReleaseService /
 * ReleaseTaskService (name <= 200, version <= 50, 1..200 task ids per call) so a bad
 * value is rejected here with a clear message instead of as a 1001 round-trip.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTaskIdsBody = exports.buildRequestApprovalBody = exports.buildUpdateBody = exports.buildCreateBody = exports.buildListParams = exports.RELEASE_ERROR_CODES = exports.MAX_TASK_IDS = exports.MAX_VERSION = exports.MAX_NAME = exports.STATUSES = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.STATUSES = ['planned', 'in_progress', 'awaiting_approval', 'released', 'cancelled'];
exports.MAX_NAME = 200;
exports.MAX_VERSION = 50;
exports.MAX_TASK_IDS = 200;
exports.RELEASE_ERROR_CODES = {
    1000: '缺少必填参数',
    1001: '参数值不合法（日期倒置 / 任务不存在或不属于该产品 / 任务数超限等）',
    1002: 'Release / 产品不存在（或已删除）',
    1006: '冲突：版本号已存在，或任务已属于另一个未取消的 Release，或该 Release 已有待处理审批',
    1007: '当前状态不允许该操作（planned→start→in_progress→request-approval→awaiting_approval；仅 planned/in_progress 可编辑/取消/调整任务，仅 planned/cancelled 可删除）',
    2000: '无权访问：你不是该产品所属组织的成员',
};
/** Only the fields that were given: on update an omitted field means "unchanged". */
function applyReleaseFields(body, o) {
    if (o.name !== undefined)
        body.name = (0, cliHelpers_1.requireText)(o.name, exports.MAX_NAME, '--name');
    if (o.version !== undefined)
        body.version = (0, cliHelpers_1.requireText)(o.version, exports.MAX_VERSION, '--version');
    if (o.description !== undefined)
        body.description = o.description;
    if (o.start !== undefined)
        body.plannedStartDate = (0, cliHelpers_1.parseDate)(o.start, '--start');
    if (o.end !== undefined)
        body.plannedEndDate = (0, cliHelpers_1.parseDate)(o.end, '--end');
    if (body.plannedStartDate && body.plannedEndDate && body.plannedEndDate < body.plannedStartDate) {
        throw new cliHelpers_1.InputError(`--end (${body.plannedEndDate}) 不能早于 --start (${body.plannedStartDate})`);
    }
}
function buildListParams(o) {
    const params = { productId: (0, cliHelpers_1.resolveProductId)(o.product) };
    if (o.status !== undefined)
        params.status = (0, cliHelpers_1.requireOneOf)(o.status, exports.STATUSES, '--status');
    return params;
}
exports.buildListParams = buildListParams;
function buildCreateBody(o) {
    const body = {
        productId: (0, cliHelpers_1.resolveProductId)(o.product),
        name: (0, cliHelpers_1.requireText)(o.name, exports.MAX_NAME, '--name'),
        version: (0, cliHelpers_1.requireText)(o.version, exports.MAX_VERSION, '--version'),
    };
    applyReleaseFields(body, o);
    return body;
}
exports.buildCreateBody = buildCreateBody;
function buildUpdateBody(o) {
    const body = {};
    applyReleaseFields(body, o);
    if (Object.keys(body).length === 0) {
        throw new cliHelpers_1.InputError('没有要修改的字段：至少指定 --name / --version / --description / --start / --end 之一');
    }
    return body;
}
exports.buildUpdateBody = buildUpdateBody;
function buildRequestApprovalBody(description) {
    return description === undefined ? {} : { description };
}
exports.buildRequestApprovalBody = buildRequestApprovalBody;
function buildTaskIdsBody(raw) {
    return { taskIds: (0, cliHelpers_1.parseIdList)(raw, '--task-ids', exports.MAX_TASK_IDS) };
}
exports.buildTaskIdsBody = buildTaskIdsBody;
//# sourceMappingURL=input.js.map