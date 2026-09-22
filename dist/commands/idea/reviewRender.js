"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderReview = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
/** `value（AI 修正前 raw）` — raw only exists for AI solutions. */
const withRaw = (value, raw, suffix = '') => (0, cliHelpers_1.fmtNum)(value, suffix) + (raw !== null && raw !== undefined ? `（AI 修正前 ${(0, cliHelpers_1.fmtNum)(raw, suffix)}）` : '');
function renderExpected(e) {
    if (!e)
        return ['预期:     (无：Idea 没有选定方案)'];
    const lines = [
        `预期（选定方案 #${(0, cliHelpers_1.dash)(e.solutionId)} ${(0, cliHelpers_1.dash)(e.solutionName)}）`,
        `  人日: ${withRaw(e.effortDays, e.rawEffortDays)}    周期: ${withRaw(e.cycleWeeks, e.rawCycleWeeks, ' 周')}    成本: ${withRaw(e.cost, e.rawCost)}`,
    ];
    if (e.kpis?.length) {
        lines.push(`  KPI: ${e.kpis.map((k) => `${(0, cliHelpers_1.dash)(k.name)} ${(0, cliHelpers_1.dash)(k.current)} → ${(0, cliHelpers_1.dash)(k.target)}${k.unit ? ` ${k.unit}` : ''}`).join('；')}`);
    }
    return lines;
}
function renderMetrics(metrics) {
    if (!metrics.length)
        return '手工指标: (暂无，用 idea review metrics --metric "name:expected:actual:unit" 填写)';
    const rows = [['指标', '预期', '实际', '单位', '准确度']].concat(metrics.map((m) => [(0, cliHelpers_1.dash)(m.name), (0, cliHelpers_1.fmtNum)(m.expected, '', 4), (0, cliHelpers_1.fmtNum)(m.actual, '', 4), (0, cliHelpers_1.dash)(m.unit), (0, cliHelpers_1.fmtNum)(m.accuracyPct, '%')]));
    return `手工指标 (${metrics.length})\n${(0, cliHelpers_1.renderTable)(rows)}`;
}
function renderReview(result) {
    const r = result.review;
    const a = result.accuracy;
    const done = r.status === 'completed';
    const lines = [
        `效果复盘 — Idea #${(0, cliHelpers_1.dash)(r.ideaId)}  状态: ${(0, cliHelpers_1.dash)(r.status)}    发布: ${r.releaseId ? `#${r.releaseId}` : cliHelpers_1.DASH}`,
        '─'.repeat(60),
        ...renderExpected(r.expected),
        '实际（自动收集自关联任务；— 表示不可得，不是 0）',
        `  人日: ${(0, cliHelpers_1.fmtNum)(r.actualEffortDays)}    周期: ${(0, cliHelpers_1.fmtNum)(r.actualCycleWeeks, ' 周')}    成本: ${(0, cliHelpers_1.fmtNum)(r.actualCost)}`,
        '  成本口径: 仅人力成本 = 关联任务实际工时 × 预算人力费率（产品预算币种）；没有费率 / 关联任务 / 已记录工时时为 —，成本准确度也随之为 —',
        `准确度（${done ? '完成时冻结' : '草稿为实时计算'}）`,
        `  人日: ${(0, cliHelpers_1.fmtNum)(a?.effortAccuracyPct, '%')}    进度: ${(0, cliHelpers_1.fmtNum)(a?.scheduleAccuracyPct, '%')}    成本: ${(0, cliHelpers_1.fmtNum)(a?.costAccuracyPct, '%')}    效果: ${(0, cliHelpers_1.fmtNum)(a?.effectAccuracyPct, '%')}`,
        '',
        renderMetrics(result.metrics ?? []),
    ];
    if (r.notes)
        lines.push('', '备注:', r.notes);
    if (done)
        lines.push('', `已完成: ${(0, cliHelpers_1.fmtDate)(r.reviewedAt)} by ${(0, cliHelpers_1.dash)(r.reviewedBy)}（不可再刷新 / 修改；估算修正系数已重算，见 idea correction）`);
    return lines.join('\n');
}
exports.renderReview = renderReview;
//# sourceMappingURL=reviewRender.js.map