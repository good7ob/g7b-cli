"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderReportList = exports.renderReport = exports.renderReportMeta = void 0;
const cliHelpers_1 = require("../../../utils/cliHelpers");
const kpi_1 = require("./kpi");
const period = (r) => (r.periodFrom || r.periodTo ? `${(0, cliHelpers_1.dash)(r.periodFrom)} ~ ${(0, cliHelpers_1.dash)(r.periodTo)}` : cliHelpers_1.DASH);
/** Meta block shared by generate and get; the AI part is always spelled out. */
function renderReportMeta(r) {
    const lines = [
        (0, kpi_1.block)([
            ['报告', `#${r.id}  ${(0, cliHelpers_1.dash)(r.title)}`],
            ['类型 / 期间', `${(0, cliHelpers_1.dash)(r.periodType)}  ${period(r)}`],
            ['范围', r.releaseId ? `Release #${r.releaseId}` : '产品级'],
            ['生成', `${(0, cliHelpers_1.fmtDateTime)(r.createdAt)} by ${(0, cliHelpers_1.dash)(r.createdBy)}`],
        ]),
    ];
    if (r.aiPolished)
        lines.push(`含 AI 生成的摘要章节（模型 ${(0, cliHelpers_1.dash)(r.aiModel)}；AI 生成，需人工确认，其余章节的数字来自确定性计算）`);
    if (r.aiWarning)
        lines.push(`⚠ AI 摘要未生成：${r.aiWarning}（报告本身已完整生成并保存）`);
    return lines.join('\n');
}
exports.renderReportMeta = renderReportMeta;
function renderReport(r, verb) {
    const body = r.contentMarkdown ? r.contentMarkdown : '（报告没有正文）';
    return [verb ? `✓ 管理报告已${verb}` : '', renderReportMeta(r), '─'.repeat(60), body].filter((part, i) => i > 0 || part).join('\n');
}
exports.renderReport = renderReport;
function renderReportList(page) {
    const records = page.records ?? [];
    if (!records.length)
        return '没有管理报告。';
    const rows = [['ID', '类型', '期间', 'Release', 'AI', '生成时间', '标题']].concat(records.map((r) => [String(r.id), (0, cliHelpers_1.dash)(r.periodType), period(r), (0, cliHelpers_1.dash)(r.releaseId), r.aiPolished ? '是' : '否', (0, cliHelpers_1.fmtDateTime)(r.createdAt), (0, cliHelpers_1.dash)(r.title)]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 6: { truncate: 40 } })}\n共 ${(0, cliHelpers_1.dash)(page.total)} 条，第 ${(0, cliHelpers_1.dash)(page.current)}/${(0, cliHelpers_1.dash)(page.pages)} 页；全文: good7ob pm health report get <id> [--out file.md]`;
}
exports.renderReportList = renderReportList;
//# sourceMappingURL=renderReport.js.map