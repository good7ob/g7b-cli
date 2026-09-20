"use strict";
/** Renderers for categories, tags, reviews, packages and the admin review queue. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderReviewQueue = exports.renderPackage = exports.renderPackageList = exports.renderReviewSaved = exports.renderReviewList = exports.renderTags = exports.renderCategories = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const extractRecords_1 = require("../../utils/extractRecords");
const render_1 = require("./render");
function categoryLines(nodes, depth) {
    return nodes.flatMap((c) => [
        `${'  '.repeat(depth)}#${(0, cliHelpers_1.dash)(c.id)} ${(0, cliHelpers_1.dash)(c.name)}  (${(0, cliHelpers_1.dash)(c.code)}, ${(0, cliHelpers_1.dash)(c.templateType)})`,
        ...categoryLines(c.children ?? [], depth + 1),
    ]);
}
function renderCategories(result) {
    const roots = (0, extractRecords_1.extractRecords)(result);
    return roots.length ? categoryLines(roots, 0).join('\n') : '没有分类。';
}
exports.renderCategories = renderCategories;
function renderTags(result) {
    const tags = (0, extractRecords_1.extractRecords)(result);
    if (!tags.length)
        return '没有标签。';
    return (0, cliHelpers_1.renderTable)([['ID', '类型', '名称']].concat(tags.map((t) => [(0, cliHelpers_1.dash)(t.id), (0, cliHelpers_1.dash)(t.kind), (0, cliHelpers_1.dash)(t.name)])));
}
exports.renderTags = renderTags;
function renderReviewList(result, pageNum, pageSize) {
    const records = (0, extractRecords_1.extractRecords)(result);
    if (!records.length)
        return '暂无评价。';
    const rows = [['ID', '用户', '评分', '时间', '评论']].concat(records.map((r) => [(0, cliHelpers_1.dash)(r.id), (0, cliHelpers_1.dash)(r.userId), r.rating ? '★'.repeat(r.rating) : cliHelpers_1.DASH, (0, cliHelpers_1.fmtDateTime)(r.updatedAt ?? r.createdAt), (0, cliHelpers_1.dash)(r.comment)]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 4: { truncate: 60 } })}\n${(0, render_1.pageFooter)(result, records, pageNum, pageSize)}`;
}
exports.renderReviewList = renderReviewList;
function renderReviewSaved(r, templateId) {
    return `✓ 已评价模板 #${templateId}: ${r?.rating ? '★'.repeat(r.rating) : cliHelpers_1.DASH}${r?.comment ? ` — ${r.comment}` : ''}`;
}
exports.renderReviewSaved = renderReviewSaved;
function renderPackageList(result, pageNum, pageSize) {
    const records = (0, extractRecords_1.extractRecords)(result);
    if (!records.length)
        return '没有模板包。';
    const rows = [['ID', '状态', '可见', '安装', '创建时间', '名称']].concat(records.map((p) => [String(p.id), (0, cliHelpers_1.dash)(p.status), (0, cliHelpers_1.dash)(p.visibility), (0, cliHelpers_1.dash)(p.installCount), (0, cliHelpers_1.fmtDateTime)(p.createdAt), `${p.isOfficial ? '★ ' : ''}${(0, cliHelpers_1.dash)(p.name)}`]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 5: { truncate: 40 } })}\n${(0, render_1.pageFooter)(result, records, pageNum, pageSize)}`;
}
exports.renderPackageList = renderPackageList;
function renderPackage(p) {
    const items = p.items ?? [];
    const owner = p.orgId ? `组织 #${p.orgId}` : `${(0, cliHelpers_1.dash)(p.ownerType)} #${(0, cliHelpers_1.dash)(p.ownerId)}`;
    const lines = [
        `模板包 #${p.id}  ${p.isOfficial ? '★ ' : ''}${(0, cliHelpers_1.dash)(p.name)}`,
        '─'.repeat(60),
        `状态:     ${(0, cliHelpers_1.dash)(p.status)}    可见性: ${(0, cliHelpers_1.dash)(p.visibility)}    所有者: ${owner}    定价: ${(0, cliHelpers_1.dash)(p.pricingType)}`,
        `热度:     安装 ${(0, cliHelpers_1.dash)(p.installCount)}  实例化 ${(0, cliHelpers_1.dash)(p.instantiateCount)}    ${p.canManage ? '可管理' : '只读'}`,
        `时间:     创建 ${(0, cliHelpers_1.fmtDateTime)(p.createdAt)} by ${(0, cliHelpers_1.dash)(p.createdBy)}    更新 ${(0, cliHelpers_1.fmtDateTime)(p.updatedAt)}`,
        ...(p.description ? ['', '描述:', p.description] : []),
        '',
    ];
    if (!items.length)
        return [...lines, `条目: ${cliHelpers_1.DASH}`].join('\n');
    // name / type / status / version are null when the caller cannot see that template in the library
    const rows = [['模板', '名称', '类型', '状态', '已发布版本', '版本约束']].concat(items.map((i) => [`#${(0, cliHelpers_1.dash)(i.templateId)}`, (0, cliHelpers_1.dash)(i.templateName), (0, cliHelpers_1.dash)(i.templateType), (0, cliHelpers_1.dash)(i.templateStatus), (0, cliHelpers_1.dash)(i.publishedVersion), (0, cliHelpers_1.dash)(i.versionConstraint)]));
    return [...lines, `条目 (${items.length})`, (0, cliHelpers_1.renderTable)(rows)].join('\n');
}
exports.renderPackage = renderPackage;
function renderReviewQueue(result, pageNum, pageSize) {
    const records = (0, extractRecords_1.extractRecords)(result);
    if (!records.length)
        return '审核队列为空。';
    const rows = [['版本ID', '模板', '类型', '版本', '模板状态', '提交时间', '提交人', '名称']].concat(records.map((r) => [
        (0, cliHelpers_1.dash)(r.versionId), `#${(0, cliHelpers_1.dash)(r.templateId)}`, (0, cliHelpers_1.dash)(r.templateType), (0, cliHelpers_1.dash)(r.version), (0, cliHelpers_1.dash)(r.templateStatus),
        (0, cliHelpers_1.fmtDateTime)(r.submittedAt), (0, cliHelpers_1.dash)(r.submittedBy), (0, cliHelpers_1.dash)(r.templateName),
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 7: { truncate: 40 } })}\n${(0, render_1.pageFooter)(result, records, pageNum, pageSize)}`;
}
exports.renderReviewQueue = renderReviewQueue;
//# sourceMappingURL=renderMisc.js.map