"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderExplain = exports.renderDiagnosis = exports.renderFindings = void 0;
const cliHelpers_1 = require("../../../utils/cliHelpers");
const kpi_1 = require("./kpi");
const renderForecast_1 = require("./renderForecast");
const SEVERITY = { CRITICAL: '严重', WARNING: '警告', INFO: '提示', OK: '正常' };
const TRENDS = { IMPROVING: '上升', STABLE: '持平', DECLINING: '下降', INSUFFICIENT_DATA: '数据不足' };
const severity = (s) => (s ? `${SEVERITY[s] ?? s} (${s})` : cliHelpers_1.DASH);
function renderFindings(findings) {
    if (!findings.length)
        return '没有发现需要关注的问题。';
    return (0, cliHelpers_1.renderTable)([['级别', '代码', '说明']].concat(findings.map((f) => [(0, cliHelpers_1.dash)(f.severity), (0, cliHelpers_1.dash)(f.code), (0, cliHelpers_1.dash)(f.message)])));
}
exports.renderFindings = renderFindings;
function renderFacts(facts) {
    const v = facts.velocity;
    const g = facts.scopeGrowth;
    return (0, kpi_1.block)([
        ['加权进度', (0, cliHelpers_1.fmtNum)(facts.scope?.weightedProgress, '%')],
        ['时间进度', (0, cliHelpers_1.fmtNum)(facts.schedule?.timeProgressPct, '%', 1)],
        ['计划结束', (0, cliHelpers_1.fmtDate)(facts.schedule?.plannedEndDate)],
        ['加权延期', (0, cliHelpers_1.fmtNum)(facts.weightedDelayDays, ' 天', 1)],
        ['速度趋势', v ? `${TRENDS[v.trend ?? ''] ?? (0, cliHelpers_1.dash)(v.trend)}（近期 ${(0, cliHelpers_1.fmtNum)(v.recentAvg)} / 此前 ${(0, cliHelpers_1.fmtNum)(v.previousAvg)}，${(0, cliHelpers_1.fmtNum)(v.changePct, '%', 1)}）` : cliHelpers_1.DASH],
        ['阻塞占比', (0, cliHelpers_1.fmtNum)(facts.blocked?.blockedRatioPct, '%', 1)],
        ['范围增长', g ? `${(0, cliHelpers_1.fmtNum)(g.growthPctOfBaseline, '%', 1)}（净增 ${(0, cliHelpers_1.fmtNum)(g.netDelta)}，估计影响 ${(0, cliHelpers_1.fmtNum)(g.impactDays, ' 天', 0)}）` : cliHelpers_1.DASH],
    ]);
}
function renderModules(modules) {
    const rows = [['模块', '延期(天)', '范围占比', '延期贡献(天)', '贡献占比', '阻塞任务']].concat(modules.map((m) => [
        (0, cliHelpers_1.dash)(m.moduleName ?? m.projectId), (0, cliHelpers_1.fmtNum)(m.delayDays), (0, cliHelpers_1.fmtNum)(m.weightSharePct, '%', 1), (0, cliHelpers_1.fmtNum)(m.contributionDays, '', 1),
        (0, cliHelpers_1.fmtNum)(m.sharePct, '%', 1), (0, cliHelpers_1.dash)(m.blockedTasks),
    ]));
    return (0, cliHelpers_1.renderTable)(rows, { 0: { truncate: 30 } });
}
function renderDiagnosis(d) {
    const findings = d.findings ?? [];
    const modules = d.facts?.modules ?? [];
    const lines = [
        `进度诊断  产品 #${(0, cliHelpers_1.dash)(d.productId)}${(0, renderForecast_1.releaseLabel)(d.releaseId)}    截至 ${(0, cliHelpers_1.fmtDate)(d.asOfDate)}    总体 ${severity(d.overallSeverity)}`,
        '─'.repeat(60),
        `发现（${findings.length}）`,
        renderFindings(findings),
    ];
    if (d.facts)
        lines.push('', '事实', renderFacts(d.facts));
    if (modules.length)
        lines.push('', '模块（按延期贡献降序）', renderModules(modules));
    lines.push('', '确定性诊断（非 AI）；想要文字解读用 `good7ob pm health explain`。');
    return lines.join('\n');
}
exports.renderDiagnosis = renderDiagnosis;
function renderExplain(e) {
    const lines = [
        `AI 解读  产品 #${(0, cliHelpers_1.dash)(e.productId)}${(0, renderForecast_1.releaseLabel)(e.releaseId)}    总体 ${severity(e.overallSeverity)}`,
        '─'.repeat(60),
    ];
    if (e.question)
        lines.push(`问题: ${e.question}`, '');
    if (e.aiAvailable && e.explanation) {
        lines.push('── AI 生成，仅供参考，需人工确认 ──', e.explanation, '──────────────');
        lines.push([`模型 ${(0, cliHelpers_1.dash)(e.model)}`, `tokens ${(0, cliHelpers_1.dash)(e.tokensUsed)}`, e.cached ? '缓存命中（未再调用模型、未再扣费）' : null].filter(Boolean).join(' · '));
    }
    else {
        lines.push(`⚠ AI 解读不可用：${e.aiWarning ?? '未知原因'}（下方的确定性诊断不受影响）`);
    }
    lines.push('', '确定性诊断（非 AI）', renderFindings(e.findings ?? []));
    return lines.join('\n');
}
exports.renderExplain = renderExplain;
//# sourceMappingURL=renderDiagnosis.js.map