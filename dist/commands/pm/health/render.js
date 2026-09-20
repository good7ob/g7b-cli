"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderBaseline = exports.renderModules = exports.renderHealth = void 0;
const cliHelpers_1 = require("../../../utils/cliHelpers");
const kpi_1 = require("./kpi");
function renderHealth(h) {
    const done = h.completedTasks == null || h.totalTasks == null ? cliHelpers_1.DASH : `${h.completedTasks} / ${h.totalTasks}`;
    return [
        `产品健康  #${(0, cliHelpers_1.dash)(h.productId)}  ${(0, cliHelpers_1.dash)(h.productName)}    (as of ${(0, cliHelpers_1.fmtDate)(h.asOf)})`,
        '─'.repeat(60),
        (0, kpi_1.block)([
            ['风险等级', (0, cliHelpers_1.dash)(h.riskLevel)],
            ['模块数', (0, cliHelpers_1.dash)(h.moduleCount)],
            ['任务完成', done],
            ['剩余任务', (0, cliHelpers_1.dash)(h.remainingWork)],
            ['整体进度', (0, cliHelpers_1.fmtNum)(h.overallProgress, '%', 1)],
            ['计划进度', (0, cliHelpers_1.fmtNum)(h.plannedProgress, '%', 1)],
            ['进度偏差', (0, cliHelpers_1.fmtNum)(h.scheduleVariance, '%', 1)],
        ]),
        '',
        ...(0, kpi_1.renderScopeSections)(h, `pm health baseline ${(0, cliHelpers_1.dash)(h.productId)}`),
    ].join('\n');
}
exports.renderHealth = renderHealth;
function renderModules(modules) {
    if (!modules.length)
        return '该产品下没有模块。';
    const pair = (a, b) => (a == null || b == null ? cliHelpers_1.DASH : `${a}/${b}`);
    const rows = [['模块', '负责人', '实际', '计划', '偏差', '延期天', '加权', '预计完成', '风险', '完成/总', '阻塞']].concat(modules.map((m) => [
        (0, cliHelpers_1.dash)(m.moduleName), (0, cliHelpers_1.dash)(m.ownerName ?? m.ownerId), (0, cliHelpers_1.fmtNum)(m.actualProgress, '%', 1), (0, cliHelpers_1.fmtNum)(m.plannedProgress, '%', 1),
        (0, cliHelpers_1.fmtNum)(m.progressVariance, '%', 1), (0, cliHelpers_1.dash)(m.delayDays), (0, cliHelpers_1.fmtNum)(m.weightedProgress, '%'), (0, cliHelpers_1.fmtDate)(m.expectedEndDate),
        (0, cliHelpers_1.dash)(m.riskLevel), pair(m.completedTasks, m.totalTasks), (0, cliHelpers_1.dash)(m.blockedTasks),
    ]));
    const basis = modules.find((m) => m.weightBasis)?.weightBasis;
    const footer = `共 ${modules.length} 个模块（按延期天数降序）${basis ? `；加权进度口径 ${(0, kpi_1.basisLabel)(basis)}` : ''}`;
    return `${(0, cliHelpers_1.renderTable)(rows, { 0: { truncate: 28 } })}\n${footer}`;
}
exports.renderModules = renderModules;
function renderBaseline(b) {
    return [
        `✓ 已将当前范围设为新基线 #${(0, cliHelpers_1.dash)(b.baselineId)}`,
        (0, kpi_1.block)([
            ['产品', (0, cliHelpers_1.dash)(b.productId)],
            ['基线范围', (0, cliHelpers_1.fmtNum)(b.baselineScopeWeight)],
            ['任务数', (0, cliHelpers_1.dash)(b.baselineTaskCount)],
            ['备注', (0, cliHelpers_1.dash)(b.note)],
            ['设置人 / 时间', `${(0, cliHelpers_1.dash)(b.setBy)} @ ${(0, cliHelpers_1.fmtDate)(b.setAt)}`],
        ]),
    ].join('\n');
}
exports.renderBaseline = renderBaseline;
//# sourceMappingURL=render.js.map