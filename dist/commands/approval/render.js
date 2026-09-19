"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderApprovalDetail = exports.renderApprovalList = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const extractRecords_1 = require("../../utils/extractRecords");
const yesNo = (v) => (v === null || v === undefined ? cliHelpers_1.DASH : v ? '是' : '否');
const target = (a) => (a.targetType ? `${a.targetType}#${(0, cliHelpers_1.dash)(a.targetId)}` : cliHelpers_1.DASH);
function renderApprovalList(result, pageNum, pageSize) {
    const records = (0, extractRecords_1.extractRecords)(result);
    if (!records.length)
        return '没有符合条件的审批。';
    const rows = [['ID', '状态', '目标', '标题', '申请人', '可决定', '创建时间']].concat(records.map((a) => [
        String(a.id), (0, cliHelpers_1.dash)(a.status), target(a), (0, cliHelpers_1.dash)(a.title), (0, cliHelpers_1.dash)(a.requestedBy), yesNo(a.canDecide), (0, cliHelpers_1.fmtDateTime)(a.createdAt),
    ]));
    const total = (0, extractRecords_1.extractTotal)(result, records);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return `${(0, cliHelpers_1.renderTable)(rows, { 3: { truncate: 40 } })}\n共 ${total} 条，第 ${pageNum}/${pages} 页`;
}
exports.renderApprovalList = renderApprovalList;
function renderApprovalDetail(a) {
    const lines = [
        `审批 #${a.id}  ${(0, cliHelpers_1.dash)(a.title)}`,
        '─'.repeat(60),
        `状态:     ${(0, cliHelpers_1.dash)(a.status)}    目标: ${target(a)}    产品: ${(0, cliHelpers_1.dash)(a.productId)}    组织: ${(0, cliHelpers_1.dash)(a.orgId)}`,
        `申请:     by ${(0, cliHelpers_1.dash)(a.requestedBy)} @ ${(0, cliHelpers_1.fmtDateTime)(a.createdAt)}`,
        `我能决定: ${yesNo(a.canDecide)}    我能撤销: ${yesNo(a.canCancel)}`,
    ];
    if (a.status && a.status !== 'pending') {
        lines.push(`决定:     ${a.status} by ${(0, cliHelpers_1.dash)(a.decidedBy)} @ ${(0, cliHelpers_1.fmtDateTime)(a.decidedAt)}`);
        lines.push(`意见:     ${(0, cliHelpers_1.dash)(a.decisionComment)}`);
    }
    if (a.selfApproved)
        lines.push('⚠ 自批：申请人在自己是组织唯一审批人时批准了自己的申请');
    if (a.description)
        lines.push('', '说明:', a.description);
    return lines.join('\n');
}
exports.renderApprovalDetail = renderApprovalDetail;
//# sourceMappingURL=render.js.map