"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderTemplateDetail = exports.renderTemplateHeader = exports.renderTemplateList = exports.pageFooter = exports.fmtRating = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const extractRecords_1 = require("../../utils/extractRecords");
const renderVersion_1 = require("./renderVersion");
/** The backend answers 0.00 for a template nobody rated; that is "no rating", never a rating of 0. */
const fmtRating = (t) => t.reviewCount ? `${(0, cliHelpers_1.fmtNum)(t.ratingAvg)} (${t.reviewCount})` : cliHelpers_1.DASH;
exports.fmtRating = fmtRating;
const flag = (value, yes) => (value ? yes : '');
/** Paged footer shared by every list; `total` falls back to the page length when the server omits it. */
function pageFooter(result, records, pageNum, pageSize) {
    const total = (0, extractRecords_1.extractTotal)(result, records);
    return `共 ${total} 条，第 ${pageNum}/${Math.max(1, Math.ceil(total / pageSize))} 页`;
}
exports.pageFooter = pageFooter;
function renderTemplateList(result, pageNum, pageSize, empty = '没有符合条件的模板。') {
    const records = (0, extractRecords_1.extractRecords)(result);
    if (!records.length)
        return empty;
    const rows = [['ID', '类型', '状态', '可见', '版本', '评分', '安装', '名称']].concat(records.map((t) => [
        String(t.id), (0, cliHelpers_1.dash)(t.templateType), (0, cliHelpers_1.dash)(t.status), (0, cliHelpers_1.dash)(t.visibility), (0, cliHelpers_1.dash)(t.publishedVersion),
        (0, exports.fmtRating)(t), (0, cliHelpers_1.dash)(t.installCount), `${flag(t.isOfficial, '★ ')}${(0, cliHelpers_1.dash)(t.name)}`,
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 7: { truncate: 40 } })}\n${pageFooter(result, records, pageNum, pageSize)}`;
}
exports.renderTemplateList = renderTemplateList;
function renderTemplateHeader(t) {
    const owner = t.orgId ? `组织 #${t.orgId}` : `${(0, cliHelpers_1.dash)(t.ownerType)} #${(0, cliHelpers_1.dash)(t.ownerId)}`;
    return [
        `模板 #${t.id}  ${flag(t.isOfficial, '★ ')}${(0, cliHelpers_1.dash)(t.name)}`,
        '─'.repeat(60),
        `类型:     ${(0, cliHelpers_1.dash)(t.templateType)}    状态: ${(0, cliHelpers_1.dash)(t.status)}    可见性: ${(0, cliHelpers_1.dash)(t.visibility)}    所有者: ${owner}`,
        `版本:     ${(0, cliHelpers_1.dash)(t.publishedVersion)}    评分: ${(0, exports.fmtRating)(t)}    许可: ${(0, cliHelpers_1.dash)(t.licenseType)}    定价: ${(0, cliHelpers_1.dash)(t.pricingType)}`,
        `热度:     安装 ${(0, cliHelpers_1.dash)(t.installCount)}  实例化 ${(0, cliHelpers_1.dash)(t.instantiateCount)}  收藏 ${(0, cliHelpers_1.dash)(t.favoriteCount)}  浏览 ${(0, cliHelpers_1.dash)(t.viewCount)}`,
        `标签:     ${t.tags?.length ? t.tags.map((g) => (0, cliHelpers_1.dash)(g.name)).join(', ') : cliHelpers_1.DASH}    分类: ${(0, cliHelpers_1.dash)(t.categoryId)}`,
        `我的:     ${t.favorited ? '已收藏' : '未收藏'}    ${t.canManage ? '可管理' : '只读'}`,
        ...(t.suspendReason ? [`下架原因: ${t.suspendReason}`] : []),
        `时间:     发布 ${(0, cliHelpers_1.fmtDateTime)(t.publishedAt)}    创建 ${(0, cliHelpers_1.fmtDateTime)(t.createdAt)} by ${(0, cliHelpers_1.dash)(t.createdBy)}    更新 ${(0, cliHelpers_1.fmtDateTime)(t.updatedAt)}`,
        ...(t.description ? ['', '描述:', t.description] : []),
    ];
}
exports.renderTemplateHeader = renderTemplateHeader;
function renderTemplateDetail(t) {
    const lines = renderTemplateHeader(t);
    lines.push('', t.version ? (0, renderVersion_1.renderVersion)(t.version) : '（暂无可查看的版本）');
    return lines.join('\n');
}
exports.renderTemplateDetail = renderTemplateDetail;
//# sourceMappingURL=render.js.map