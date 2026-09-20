"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderIdeaDetail = exports.renderIdeaList = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const extractRecords_1 = require("../../utils/extractRecords");
const renderSolutions_1 = require("./renderSolutions");
function renderIdeaList(result, pageNum, pageSize) {
    const records = (0, extractRecords_1.extractRecords)(result);
    if (!records.length)
        return '没有符合条件的 Idea。';
    const rows = [['ID', '状态', '优先级', '来源', '需求', '标题', '创建时间']].concat(records.map((i) => [
        String(i.id), (0, cliHelpers_1.dash)(i.status), (0, cliHelpers_1.dash)(i.priority), (0, cliHelpers_1.dash)(i.source),
        i.requirementId ? `#${i.requirementId}` : cliHelpers_1.DASH, (0, cliHelpers_1.dash)(i.title), (0, cliHelpers_1.fmtDate)(i.createdAt),
    ]));
    const total = (0, extractRecords_1.extractTotal)(result, records);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return `${(0, cliHelpers_1.renderTable)(rows, { 5: { truncate: 40 } })}\n共 ${total} 条，第 ${pageNum}/${pages} 页`;
}
exports.renderIdeaList = renderIdeaList;
function renderIdeaDetail(detail) {
    const i = detail.idea;
    const lines = [
        `Idea #${i.id}  ${(0, cliHelpers_1.dash)(i.title)}`,
        '─'.repeat(60),
        `状态:     ${(0, cliHelpers_1.dash)(i.status)}    优先级: ${(0, cliHelpers_1.dash)(i.priority)}    来源: ${(0, cliHelpers_1.dash)(i.source)}`,
        `产品:     ${(0, cliHelpers_1.dash)(i.productId)}    发布: ${i.releaseId ? `#${i.releaseId}` : cliHelpers_1.DASH}    标签: ${detail.tags?.length ? detail.tags.join(', ') : cliHelpers_1.DASH}`,
        `预期价值: ${(0, cliHelpers_1.dash)(i.expectedValue)}`,
    ];
    if (i.status === 'rejected' || i.rejectReason)
        lines.push(`驳回原因: ${(0, cliHelpers_1.dash)(i.rejectReason)}`);
    if (i.requirementId) {
        lines.push(`关联需求: #${i.requirementId}（需求收件箱，good7ob req show ${i.requirementId}）`);
    }
    else if (i.status === 'approved') {
        lines.push(`关联需求: ${(0, cliHelpers_1.dash)(i.requirementId)}`);
    }
    lines.push(`创建:     ${(0, cliHelpers_1.fmtDate)(i.createdAt)} by ${(0, cliHelpers_1.dash)(i.createdBy)}    更新: ${(0, cliHelpers_1.fmtDate)(i.updatedAt)}`);
    if (i.description)
        lines.push('', '描述:', i.description);
    lines.push('', ...(0, renderSolutions_1.renderSolutions)(detail.solutions ?? [], detail.decision));
    return lines.join('\n');
}
exports.renderIdeaDetail = renderIdeaDetail;
//# sourceMappingURL=render.js.map