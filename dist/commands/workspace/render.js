"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDecision = exports.renderTransition = exports.renderQueueCounts = exports.renderQueue = exports.renderCountsSummary = exports.ACTION_LABELS = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.ACTION_LABELS = {
    PLAN_APPROVAL: '计划审批',
    COMPLETION_APPROVAL: '完成审批',
    INFO_REQUEST: '信息请求',
    BLOCKED: '已阻塞',
    PAUSED: '已暂停',
    SYSTEM_ALERT: '系统提醒',
    REQUIREMENT_TRIAGE: '需求分诊',
    APPROVAL: '审批申请',
    RISK_ALERT: '风险预警',
};
const STATUS_HEADINGS = {
    active: '待我处理', snoozed: '已稍后', dismissed: '已忽略', done: '已完成', all: '全部',
    new: '新待办', in_progress: '处理中', waiting: '等待中',
};
/** `计划审批 3  完成审批 0 …` — every action type, a count the backend did not send is —, never 0. */
function renderCountsSummary(counts) {
    return Object.keys(exports.ACTION_LABELS)
        .map((k) => `${exports.ACTION_LABELS[k]} ${(0, cliHelpers_1.dash)(counts?.[k])}`)
        .join('  ');
}
exports.renderCountsSummary = renderCountsSummary;
/** Time cell: a live snooze wins (stored in UTC), otherwise the task deadline. */
const whenCell = (i) => i.snoozedUntil ? `稍后至 ${(0, cliHelpers_1.fmtDateTime)(i.snoozedUntil)} UTC` : (0, cliHelpers_1.fmtDateTime)(i.dueAt);
function renderQueue(queue, status) {
    const items = queue.items ?? [];
    const heading = STATUS_HEADINGS[status ?? 'active'] ?? status;
    const lines = [`${heading}: ${(0, cliHelpers_1.dash)(queue.total)}`, renderCountsSummary(queue.counts)];
    if (!items.length)
        return [...lines, '', '队列为空。'].join('\n');
    // The priority score column only appears when the backend sent one (B2 and later).
    const scored = items.some((i) => i.priorityScore != null);
    const cells = (i) => {
        const row = [
            (0, cliHelpers_1.dash)(i.id), (0, cliHelpers_1.dash)(i.status), (0, cliHelpers_1.dash)(i.sourceType), (0, cliHelpers_1.dash)(i.sourceId),
            exports.ACTION_LABELS[i.actionType ?? ''] ?? (0, cliHelpers_1.dash)(i.actionType), (0, cliHelpers_1.dash)(i.priority),
            (0, cliHelpers_1.dash)(i.projectName ?? i.projectId), (0, cliHelpers_1.dash)(i.title), whenCell(i), (0, cliHelpers_1.fmtDateTime)(i.createdAt),
        ];
        if (scored)
            row.splice(6, 0, (0, cliHelpers_1.dash)(i.priorityScore));
        return row;
    };
    const header = ['ID', '状态', '类型', '来源ID', '动作', '优先级', '项目', '标题', '到期/稍后', '创建时间'];
    if (scored)
        header.splice(6, 0, '优先分');
    const shift = scored ? 1 : 0;
    lines.push('', (0, cliHelpers_1.renderTable)([header].concat(items.map(cells)), { [6 + shift]: { truncate: 20 }, [7 + shift]: { truncate: 40 } }));
    if (typeof queue.total === 'number' && queue.total > items.length) {
        lines.push(`显示 ${items.length} / ${queue.total} 条（用 --limit 调大，最大 200）`);
    }
    return lines.join('\n');
}
exports.renderQueue = renderQueue;
/** `workspace queue counts`: active total + per action type, then the parked buckets. */
function renderQueueCounts(c) {
    return [
        `待我处理: ${(0, cliHelpers_1.dash)(c.total)}`,
        renderCountsSummary(c.counts),
        `已稍后 ${(0, cliHelpers_1.dash)(c.snoozed)}  已忽略 ${(0, cliHelpers_1.dash)(c.dismissed)}  已完成 ${(0, cliHelpers_1.dash)(c.done)}`,
    ].join('\n');
}
exports.renderQueueCounts = renderQueueCounts;
const TRANSITION_LABELS = { dismiss: '已忽略', snooze: '已稍后处理', done: '已标记处理', reopen: '已重新打开' };
const withTitle = (item) => (item?.title ? ` — ${item.title}` : '');
function renderTransition(kind, id, item) {
    const until = kind === 'snooze' && item?.snoozedUntil ? `，至 ${(0, cliHelpers_1.fmtDateTime)(item.snoozedUntil)} UTC` : '';
    return `✓ 队列项 #${id} ${TRANSITION_LABELS[kind]} (${(0, cliHelpers_1.dash)(item?.status)})${until}${withTitle(item)}`;
}
exports.renderTransition = renderTransition;
const OUTCOME_LABELS = { approved: '已批准', rejected: '已驳回' };
function renderDecision(id, result) {
    const outcome = result?.outcome ?? '';
    const resumed = result?.item?.actionType === 'PLAN_APPROVAL' && outcome === 'approved' ? '，已恢复 Agent 执行' : '';
    return `✓ 队列项 #${id} ${OUTCOME_LABELS[outcome] ?? cliHelpers_1.DASH} (${(0, cliHelpers_1.dash)(result?.outcome)})${resumed}${withTitle(result?.item)}`;
}
exports.renderDecision = renderDecision;
//# sourceMappingURL=render.js.map