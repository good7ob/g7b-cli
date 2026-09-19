"use strict";
/**
 * CLI-boundary validation for `approval` commands. Mirrors ApprovalService: status and
 * targetType are validated, page size is 1..100, a rejection needs a non-blank comment.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDecisionBody = exports.buildListParams = exports.APPROVAL_ERROR_CODES = exports.MAX_PAGE_SIZE = exports.STATUSES = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
exports.MAX_PAGE_SIZE = 100;
exports.APPROVAL_ERROR_CODES = {
    1000: '缺少必填参数（驳回必须填写 --comment）',
    1001: '参数值不合法',
    1002: '审批不存在',
    1009: '该审批已被处理（批准/驳回/撤销），无法再次操作 —— 请用 approval get 查看结果',
    2000: '无权操作：仅组织 owner/admin 可批准或驳回；申请人不能批准/驳回自己的申请（除非组织里没有其他审批人；自己的申请请用 cancel）；非组织成员不可见',
};
function buildListParams(o) {
    const params = {
        pageNum: (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000),
        pageSize: (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '20', '--page-size', 1, exports.MAX_PAGE_SIZE),
    };
    if (o.status !== undefined)
        params.status = (0, cliHelpers_1.requireOneOf)(o.status, exports.STATUSES, '--status');
    if (o.mine && params.status !== undefined && params.status !== 'pending') {
        // The backend forces status=pending for mine=true and silently drops --status.
        throw new cliHelpers_1.InputError('--mine 只返回待我决定的 pending 申请，不能与 --status ' + params.status + ' 同时使用');
    }
    if (o.targetType !== undefined)
        params.targetType = (0, cliHelpers_1.normalizeTypeCode)(o.targetType, '--target-type');
    if (o.targetId !== undefined)
        params.targetId = (0, cliHelpers_1.parseId)(o.targetId, '--target-id');
    if (o.product !== undefined)
        params.productId = (0, cliHelpers_1.parseId)(o.product, '--product');
    if (o.mine)
        params.mine = true;
    return params;
}
exports.buildListParams = buildListParams;
/** Approve: comment optional. Reject: comment required and non-blank. */
function buildDecisionBody(comment, required) {
    if (required && (comment === undefined || !comment.trim())) {
        throw new cliHelpers_1.InputError('--comment 不能为空（驳回必须说明原因）');
    }
    return comment === undefined ? {} : { comment };
}
exports.buildDecisionBody = buildDecisionBody;
//# sourceMappingURL=input.js.map