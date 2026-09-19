"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderNextActions = exports.renderDailyReport = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const render_1 = require("./render");
const KINDS = { QUEUE_ITEM: '队列项', TASK: '任务' };
const SOURCES = { template: 'template（确定性）', ai: 'ai' };
/** `generated`: shown right after `daily-report generate`, so the header says it was (re)generated. */
function renderDailyReport(r, generated = false) {
    const ai = r.source === 'ai';
    const lines = [
        `${generated ? '✓ 日报已生成  ' : ''}日报 ${(0, cliHelpers_1.dash)(r.date)}    来源 ${SOURCES[r.source ?? ''] ?? (0, cliHelpers_1.dash)(r.source)}    生成于 ${(0, cliHelpers_1.fmtDateTime)(r.generatedAt)}`,
    ];
    if (ai)
        lines.push('含 AI 叙述总结（AI 生成，需人工确认；数字来自确定性数据，不会自动执行任何动作）');
    if (r.aiWarning)
        lines.push(`⚠ 未能使用 AI：${r.aiWarning}（已降级为确定性日报）`);
    const degraded = r.sections?.degraded ?? [];
    if (degraded.length)
        lines.push(`⚠ 部分分节加载失败（该节为空）: ${degraded.join(', ')}`);
    lines.push('─'.repeat(60), r.content ? r.content : '（日报没有正文）');
    return lines.join('\n');
}
exports.renderDailyReport = renderDailyReport;
function actionBlock(a, index) {
    const where = [
        a.itemId ? `队列项 #${a.itemId}` : null,
        a.taskId ? `任务 #${a.taskId}` : null,
        a.actionType ? (render_1.ACTION_LABELS[a.actionType] ?? a.actionType) : null,
        `优先级 ${(0, cliHelpers_1.dash)(a.priority)}`,
        `到期 ${(0, cliHelpers_1.fmtDateTime)(a.dueAt)}`,
    ].filter(Boolean);
    const reasons = a.reasons?.length ? a.reasons : [cliHelpers_1.DASH];
    return [
        `${index + 1}. 得分 ${(0, cliHelpers_1.dash)(a.score)}  ${(0, cliHelpers_1.dash)(a.title)}    [${KINDS[a.kind ?? ''] ?? (0, cliHelpers_1.dash)(a.kind)}]`,
        `   ${where.join(' · ')}`,
        ...reasons.map((reason) => `   · ${reason}`),
    ];
}
function renderNextActions(n) {
    const items = n.items ?? [];
    if (!items.length)
        return `现在没有需要你处理的事项（候选 ${(0, cliHelpers_1.dash)(n.total)} 个）。`;
    return [
        `下一步推荐（候选 ${(0, cliHelpers_1.dash)(n.total)} 个，显示前 ${items.length} 个；得分越高越该先做，确定性规则、无 AI）`,
        '',
        ...items.flatMap((a, i) => [...actionBlock(a, i), '']),
        '队列项可用 `good7ob workspace queue approve|reject|dismiss|snooze <队列项id>` 直接处理。',
    ].join('\n');
}
exports.renderNextActions = renderNextActions;
//# sourceMappingURL=renderDaily.js.map