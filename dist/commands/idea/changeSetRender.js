"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderApply = exports.renderAnalyze = exports.renderChangeSetDetail = exports.renderItems = exports.renderChangeSetList = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const extractRecords_1 = require("../../utils/extractRecords");
const wrap = (width) => ({ width, wrapWord: false });
const label = (cs) => `${(0, cliHelpers_1.dash)(cs.code)} (#${cs.id})`;
function renderChangeSetList(result, pageNum, pageSize) {
    const records = (0, extractRecords_1.extractRecords)(result);
    if (!records.length)
        return '没有符合条件的变更集。';
    const rows = [['ID', '编号', '状态', 'Idea', '审批单', '标题', '创建时间']].concat(records.map((c) => [
        String(c.id), (0, cliHelpers_1.dash)(c.code), (0, cliHelpers_1.dash)(c.status), c.ideaId ? `#${c.ideaId}` : cliHelpers_1.DASH,
        c.approvalId ? `#${c.approvalId}` : cliHelpers_1.DASH, (0, cliHelpers_1.dash)(c.title), (0, cliHelpers_1.fmtDate)(c.createdAt),
    ]));
    const total = (0, extractRecords_1.extractTotal)(result, records);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return `${(0, cliHelpers_1.renderTable)(rows, { 5: wrap(40) })}\n共 ${total} 条，第 ${pageNum}/${pages} 页`;
}
exports.renderChangeSetList = renderChangeSetList;
const target = (i) => [i.objectId ? `#${i.objectId}` : '', i.objectRef ?? ''].filter(Boolean).join(' ') || cliHelpers_1.DASH;
const confirmedMark = (i) => (i.isConfirmed ? '✓ 已确认' : '✗ 待确认');
const origin = (i) => `${(0, cliHelpers_1.dash)(i.source)}${i.confidence ? `/${i.confidence}` : ''}`;
function renderItems(items) {
    if (!items.length)
        return '条目: (暂无，用 idea change-set item add 添加，或 analyze 自动收集)';
    const rows = [['ID', '类型', '变更', '对象', '说明', '来源', '确认', '任务']].concat(items.map((i) => [
        String(i.id), (0, cliHelpers_1.dash)(i.objectType), (0, cliHelpers_1.dash)(i.changeKind), target(i), (0, cliHelpers_1.dash)(i.description),
        origin(i), confirmedMark(i), i.taskId ? `#${i.taskId}` : cliHelpers_1.DASH,
    ]));
    const confirmed = items.filter((i) => i.isConfirmed).length;
    return `条目 (${items.length}，已确认 ${confirmed})\n${(0, cliHelpers_1.renderTable)(rows, { 3: wrap(30), 4: wrap(36) })}`;
}
exports.renderItems = renderItems;
function renderChangeSetDetail(detail) {
    const c = detail.changeSet;
    const lines = [
        `变更集 ${label(c)}  ${(0, cliHelpers_1.dash)(c.title)}`,
        '─'.repeat(60),
        `状态:     ${(0, cliHelpers_1.dash)(c.status)}    Idea: ${c.ideaId ? `#${c.ideaId}` : cliHelpers_1.DASH}    方案: ${c.solutionId ? `#${c.solutionId}` : cliHelpers_1.DASH}    产品: ${(0, cliHelpers_1.dash)(c.productId)}`,
        `审批单:   ${c.approvalId ? `#${c.approvalId}（good7ob approval get ${c.approvalId}）` : cliHelpers_1.DASH}    模块: ${c.moduleId ? `#${c.moduleId}` : cliHelpers_1.DASH}`,
        `创建:     ${(0, cliHelpers_1.fmtDate)(c.createdAt)} by ${(0, cliHelpers_1.dash)(c.createdBy)}    更新: ${(0, cliHelpers_1.fmtDate)(c.updatedAt)}`,
    ];
    if (c.appliedAt || c.appliedBy)
        lines.push(`Apply:    ${(0, cliHelpers_1.fmtDate)(c.appliedAt)} by ${(0, cliHelpers_1.dash)(c.appliedBy)}`);
    if (c.summary)
        lines.push('', '摘要:', c.summary);
    lines.push('', renderItems(detail.items ?? []));
    return lines.join('\n');
}
exports.renderChangeSetDetail = renderChangeSetDetail;
function renderAnalyze(result) {
    const added = result.added;
    const lines = [
        `✓ 影响分析完成: ${label(result.changeSet)} → ${(0, cliHelpers_1.dash)(result.changeSet.status)}；本次新增 追溯 ${(0, cliHelpers_1.dash)(added?.trace)} 条 / AI 建议 ${(0, cliHelpers_1.dash)(added?.ai)} 条（只追加，不删除已有条目）`,
    ];
    if (result.warning)
        lines.push(`⚠ 告警（分析仍成功；AI 建议可能已降级为仅追溯条目）: ${result.warning}`);
    lines.push('追溯 / AI 条目默认「待确认」，须逐条 idea change-set item confirm 后才会计入 submit / apply', '', renderItems(result.items ?? []));
    return lines.join('\n');
}
exports.renderAnalyze = renderAnalyze;
function renderApply(result) {
    const tasks = result.tasks ?? [];
    const lines = [
        `✓ 已 Apply: ${label(result.changeSet)} → ${(0, cliHelpers_1.dash)(result.changeSet.status)}；任务所属模块 #${(0, cliHelpers_1.dash)(result.moduleId)}；Idea 状态: ${(0, cliHelpers_1.dash)(result.ideaStatus)}`,
        `已创建任务 ${tasks.length} 个，新建追溯关系 ${(0, cliHelpers_1.dash)(result.traceLinks)} 条`,
    ];
    if (tasks.length) {
        lines.push((0, cliHelpers_1.renderTable)([['条目', '任务']].concat(tasks.map((t) => [`#${t.itemId}`, `#${t.taskId}`]))));
    }
    if (result.summary)
        lines.push('', result.summary);
    lines.push('⚠ Apply 只生成任务与追溯关系，不会自动修改 PRD / UI / API / DB 等文档，请按条目自行更新文档。');
    return lines.join('\n');
}
exports.renderApply = renderApply;
//# sourceMappingURL=changeSetRender.js.map