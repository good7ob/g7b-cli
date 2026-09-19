"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderQueue = exports.ACTION_LABELS = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.ACTION_LABELS = {
    PLAN_APPROVAL: '计划审批',
    COMPLETION_APPROVAL: '完成审批',
    INFO_REQUEST: '信息请求',
    BLOCKED: '已阻塞',
    PAUSED: '已暂停',
    SYSTEM_ALERT: '系统提醒',
    REQUIREMENT_TRIAGE: '需求分诊',
};
function renderQueue(queue) {
    const items = queue.items ?? [];
    const counts = queue.counts ?? {};
    const summary = Object.keys(exports.ACTION_LABELS)
        .map((k) => `${exports.ACTION_LABELS[k]} ${(0, cliHelpers_1.dash)(counts[k])}`)
        .join('  ');
    const lines = [`待我处理: ${(0, cliHelpers_1.dash)(queue.total)}`, summary];
    if (!items.length)
        return [...lines, '', '队列为空。'].join('\n');
    const rows = [['类型', 'ID', '动作', '优先级', '项目', '标题', '创建时间']].concat(items.map((i) => [
        (0, cliHelpers_1.dash)(i.sourceType), (0, cliHelpers_1.dash)(i.sourceId), exports.ACTION_LABELS[i.actionType ?? ''] ?? (0, cliHelpers_1.dash)(i.actionType),
        (0, cliHelpers_1.dash)(i.priority), (0, cliHelpers_1.dash)(i.projectName ?? i.projectId), (0, cliHelpers_1.dash)(i.title), (0, cliHelpers_1.fmtDate)(i.createdAt),
    ]));
    lines.push('', (0, cliHelpers_1.renderTable)(rows, { 4: { truncate: 20 }, 5: { truncate: 40 } }));
    if (typeof queue.total === 'number' && queue.total > items.length) {
        lines.push(`显示 ${items.length} / ${queue.total} 条（用 --limit 调大，最大 200）`);
    }
    return lines.join('\n');
}
exports.renderQueue = renderQueue;
//# sourceMappingURL=render.js.map