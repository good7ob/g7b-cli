"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMerge = exports.renderDuplicates = exports.renderRelations = exports.renderAttachments = exports.fmtBytes = exports.renderComments = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const extractRecords_1 = require("../../utils/extractRecords");
const wrap = (width) => ({ width, wrapWord: false });
function renderComments(result, pageNum, pageSize) {
    const records = (0, extractRecords_1.extractRecords)(result);
    if (!records.length)
        return '还没有评论。';
    const rows = [['ID', '作者', '回复', '时间', '内容']].concat(records.map((c) => [
        String(c.id), (0, cliHelpers_1.dash)(c.authorId), c.parentId ? `#${c.parentId}` : '', (0, cliHelpers_1.fmtDate)(c.createdAt), (0, cliHelpers_1.dash)(c.content),
    ]));
    const total = (0, extractRecords_1.extractTotal)(result, records);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return `${(0, cliHelpers_1.renderTable)(rows, { 4: wrap(60) })}\n共 ${total} 条，第 ${pageNum}/${pages} 页`;
}
exports.renderComments = renderComments;
/** 1536 -> "1.5 KB"; null -> —. */
function fmtBytes(bytes) {
    if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes)))
        return (0, cliHelpers_1.dash)(null);
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(0, cliHelpers_1.fmtNum)(bytes / 1024, ' KB', 1)}`;
    return `${(0, cliHelpers_1.fmtNum)(bytes / 1024 / 1024, ' MB', 1)}`;
}
exports.fmtBytes = fmtBytes;
function renderAttachments(list) {
    if (!list.length)
        return '还没有附件。';
    const rows = [['ID', '文件名', '类型', '大小', '登记人', '时间', '地址']].concat(list.map((a) => [
        String(a.id), (0, cliHelpers_1.dash)(a.fileName), (0, cliHelpers_1.dash)(a.contentType), fmtBytes(a.sizeBytes), (0, cliHelpers_1.dash)(a.uploadedBy),
        (0, cliHelpers_1.fmtDate)(a.createdAt), (0, cliHelpers_1.dash)(a.fileUrl),
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 1: wrap(30) })}\n共 ${list.length} 个`;
}
exports.renderAttachments = renderAttachments;
const ARROW = { outgoing: '→', incoming: '←' };
function renderRelations(list) {
    if (!list.length)
        return '没有关联的 Idea。';
    const rows = [['ID', '关系', '对方', '状态', '标题']].concat(list.map((r) => [
        String(r.id), `${ARROW[r.direction ?? ''] ?? '?'} ${(0, cliHelpers_1.dash)(r.relationType)}`,
        (0, cliHelpers_1.dash)(r.otherIdeaId === null || r.otherIdeaId === undefined ? null : `#${r.otherIdeaId}`),
        (0, cliHelpers_1.dash)(r.otherStatus), (0, cliHelpers_1.dash)(r.otherTitle),
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 4: wrap(40) })}\n→ 本 Idea 指向对方，← 对方指向本 Idea`;
}
exports.renderRelations = renderRelations;
function renderDuplicates(list) {
    if (!list.length)
        return '没有疑似重复的 Idea。';
    const rows = [['ID', '相似度', '状态', '标题']].concat(list.map((d) => [String(d.ideaId), (0, cliHelpers_1.fmtNum)(d.similarity), (0, cliHelpers_1.dash)(d.status), (0, cliHelpers_1.dash)(d.title)]));
    return (0, cliHelpers_1.renderTable)(rows, { 3: wrap(50) });
}
exports.renderDuplicates = renderDuplicates;
function renderMerge(id, targetId, r) {
    return `✓ Idea #${id} 已合并到 #${targetId}（源已归档；迁移 方案 ${(0, cliHelpers_1.dash)(r?.movedSolutions)} / 评论 ${(0, cliHelpers_1.dash)(r?.movedComments)}` +
        ` / 附件 ${(0, cliHelpers_1.dash)(r?.movedAttachments)} / 标签 ${(0, cliHelpers_1.dash)(r?.movedTags)}）`;
}
exports.renderMerge = renderMerge;
//# sourceMappingURL=renderCollab.js.map