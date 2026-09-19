"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderReleaseTasks = exports.renderReleaseDetail = exports.renderReleaseList = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
function renderReleaseList(releases) {
    if (!releases.length)
        return '没有符合条件的 Release。';
    const rows = [['ID', '状态', '版本', '名称', '任务', '计划开始', '计划结束']].concat(releases.map((r) => [
        String(r.id), (0, cliHelpers_1.dash)(r.status), (0, cliHelpers_1.dash)(r.version), (0, cliHelpers_1.dash)(r.name), (0, cliHelpers_1.dash)(r.taskCount),
        (0, cliHelpers_1.dash)(r.plannedStartDate), (0, cliHelpers_1.dash)(r.plannedEndDate),
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 3: { truncate: 30 } })}\n共 ${releases.length} 个 Release`;
}
exports.renderReleaseList = renderReleaseList;
function renderReleaseDetail(r) {
    const lines = [
        `Release #${r.id}  ${(0, cliHelpers_1.dash)(r.name)}`,
        '─'.repeat(60),
        `状态:     ${(0, cliHelpers_1.dash)(r.status)}    版本: ${(0, cliHelpers_1.dash)(r.version)}    产品: ${(0, cliHelpers_1.dash)(r.productId)}`,
        `计划:     ${(0, cliHelpers_1.dash)(r.plannedStartDate)} → ${(0, cliHelpers_1.dash)(r.plannedEndDate)}    发布于: ${(0, cliHelpers_1.fmtDateTime)(r.releasedAt)}`,
        `任务数:   ${(0, cliHelpers_1.dash)(r.taskCount)}（good7ob release tasks ${r.id}）`,
    ];
    if (r.pendingApprovalId) {
        lines.push(`待处理审批: #${r.pendingApprovalId}（good7ob approval get ${r.pendingApprovalId}）`);
    }
    lines.push(`创建:     ${(0, cliHelpers_1.fmtDateTime)(r.createdAt)} by ${(0, cliHelpers_1.dash)(r.createdBy)}    更新: ${(0, cliHelpers_1.fmtDateTime)(r.updatedAt)}`);
    if (r.description)
        lines.push('', '描述:', r.description);
    return lines.join('\n');
}
exports.renderReleaseDetail = renderReleaseDetail;
function renderReleaseTasks(tasks) {
    if (!tasks.length)
        return '该 Release 还没有关联任务（用 release tasks add 添加）。';
    const rows = [['ID', '状态', '进度', '任务', '项目', '负责人']].concat(tasks.map((t) => [
        String(t.id), (0, cliHelpers_1.dash)(t.status), (0, cliHelpers_1.fmtNum)(t.progress, '%'), (0, cliHelpers_1.dash)(t.name), (0, cliHelpers_1.dash)(t.projectId), (0, cliHelpers_1.dash)(t.responsibleId),
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 3: { truncate: 40 } })}\n共 ${tasks.length} 个任务`;
}
exports.renderReleaseTasks = renderReleaseTasks;
//# sourceMappingURL=render.js.map