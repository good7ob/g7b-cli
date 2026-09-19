"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderReleaseBaseline = exports.renderReleaseHealth = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const kpi_1 = require("../pm/health/kpi");
function renderReleaseHealth(h) {
    const done = h.completedTasks == null || h.totalTasks == null ? cliHelpers_1.DASH : `${h.completedTasks} / ${h.totalTasks}`;
    return [
        `Release 健康  #${(0, cliHelpers_1.dash)(h.releaseId)}  ${(0, cliHelpers_1.dash)(h.version)}  ${(0, cliHelpers_1.dash)(h.releaseName)}    (as of ${(0, cliHelpers_1.fmtDate)(h.asOf)})`,
        '─'.repeat(60),
        (0, kpi_1.block)([
            ['状态', (0, cliHelpers_1.dash)(h.status)],
            ['产品', (0, cliHelpers_1.dash)(h.productId)],
            ['任务完成', done],
        ]),
        '',
        ...(0, kpi_1.renderScopeSections)(h, `release baseline ${(0, cliHelpers_1.dash)(h.releaseId)}`),
    ].join('\n');
}
exports.renderReleaseHealth = renderReleaseHealth;
function renderReleaseBaseline(b) {
    return [
        `✓ 已将 Release #${(0, cliHelpers_1.dash)(b.releaseId)} 当前范围设为新基线 #${(0, cliHelpers_1.dash)(b.baselineId)}`,
        (0, kpi_1.block)([
            ['基线范围', (0, cliHelpers_1.fmtNum)(b.baselineScope)],
            ['口径', (0, kpi_1.basisLabel)(b.weightBasis)],
            ['任务数', (0, cliHelpers_1.dash)(b.baselineTaskCount)],
            ['备注', (0, cliHelpers_1.dash)(b.note)],
            ['设置人 / 时间', `${(0, cliHelpers_1.dash)(b.setBy)} @ ${(0, cliHelpers_1.fmtDateTime)(b.setAt)}`],
        ]),
    ].join('\n');
}
exports.renderReleaseBaseline = renderReleaseBaseline;
//# sourceMappingURL=progressRender.js.map