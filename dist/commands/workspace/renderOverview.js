"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderOverview = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const render_1 = require("./render");
const renderAiTeam_1 = require("./renderAiTeam");
const renderViews_1 = require("./renderViews");
const ACTIVITY_LABELS = { STATE_CHANGE: '状态变更', COMMENT: '评论', AI_WORK: 'AI 工作' };
const FAILED = '（加载失败）';
const section = (title, body) => `── ${title} ──\n${body}`;
function productsBlock(products) {
    if (!products)
        return FAILED;
    return products.length ? (0, renderViews_1.productTable)(products) : '没有产品。';
}
function activityBlock(activity) {
    if (!activity)
        return FAILED;
    if (!activity.length)
        return '暂无动态。';
    const rows = [['时间', '类型', '任务', '执行方', '内容']].concat(activity.map((a) => [
        (0, cliHelpers_1.fmtDateTime)(a.at), ACTIVITY_LABELS[a.type ?? ''] ?? (0, cliHelpers_1.dash)(a.type),
        a.taskId ? `#${a.taskId} ${(0, cliHelpers_1.dash)(a.taskName)}` : (0, cliHelpers_1.dash)(a.taskName), (0, cliHelpers_1.dash)(a.actor), (0, cliHelpers_1.dash)(a.text),
    ]));
    return (0, cliHelpers_1.renderTable)(rows, { 2: { truncate: 30 }, 4: { truncate: 50 } });
}
function renderOverview(o) {
    const parts = [
        section('待办队列', o.queue ? (0, render_1.renderQueueCounts)(o.queue) : FAILED),
        section('我的任务', o.tasks ? (0, renderViews_1.renderTaskCounts)(o.tasks) : FAILED),
        section('我的产品（开放任务最多的前 5 个）', productsBlock(o.products)),
        section('最近动态', activityBlock(o.recentActivity)),
    ];
    // Shown only when the backend knows about it (B2+): present, or degraded while loading.
    if (o.aiTeam || o.degraded?.includes('aiTeam')) {
        parts.splice(3, 0, section('我的 AI 团队', o.aiTeam ? (0, renderAiTeam_1.renderAiTeamSummary)(o.aiTeam) : FAILED));
    }
    if (o.degraded?.length)
        parts.push(`⚠ 部分内容加载失败: ${o.degraded.join(', ')}`);
    return parts.join('\n\n');
}
exports.renderOverview = renderOverview;
//# sourceMappingURL=renderOverview.js.map