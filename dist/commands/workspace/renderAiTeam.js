"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderAiTeamSummary = exports.renderWorkLog = exports.renderAiTeam = exports.countsLine = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const STATE_LABELS = { working: '工作中', waiting: '等待中', error: '异常', idle: '空闲' };
const REASON_LABELS = { blocked_tasks: '有阻塞任务', last_record_failed: '最近工作记录失败' };
const LOG_TYPES = { WORK_RECORD: '工作记录', STATE_CHANGE: '状态变更', COMMENT: '评论', REVIEW: '评审' };
const stateCell = (e) => {
    const label = STATE_LABELS[e.state ?? ''] ?? (0, cliHelpers_1.dash)(e.state);
    return e.stateReason ? `${label}（${REASON_LABELS[e.stateReason] ?? e.stateReason}）` : label;
};
function tasksCell(e) {
    const tasks = e.currentTasks ?? [];
    if (!tasks.length)
        return cliHelpers_1.DASH;
    const first = tasks[0];
    const reason = first.blockedReason ? `/${first.blockedReason}` : '';
    return `#${(0, cliHelpers_1.dash)(first.id)} ${(0, cliHelpers_1.dash)(first.name)} [${(0, cliHelpers_1.dash)(first.status)}${reason}]${tasks.length > 1 ? `  +${tasks.length - 1}` : ''}`;
}
function countsLine(c) {
    const pick = (k) => (0, cliHelpers_1.dash)(c?.[k]);
    return Object.keys(STATE_LABELS).map((k) => `${STATE_LABELS[k]} ${pick(k)}`).join('  ');
}
exports.countsLine = countsLine;
const percent = (v) => (v == null ? cliHelpers_1.DASH : (0, cliHelpers_1.fmtNum)(v * 100, '%', 1));
function renderAiTeam(team, status) {
    const employees = team.employees ?? [];
    const filter = status && status !== 'all' ? `（筛选: ${status}）` : '';
    const head = [`我的 AI 团队: ${(0, cliHelpers_1.dash)(team.total)}${filter}`, `${countsLine(team.counts)}（各状态人数不受筛选影响）`];
    if (!employees.length)
        return [...head, '', '没有 AI 员工。'].join('\n');
    const rows = [['ID', '名称', '组织', '状态', '当前任务', '排队', '完成', '成功率', '工时(h)', 'Tokens', '说明充分度', '被驳回', '阻塞']].concat(employees.map((e) => [
        (0, cliHelpers_1.dash)(e.id), (0, cliHelpers_1.dash)(e.name), (0, cliHelpers_1.dash)(e.orgName), stateCell(e), tasksCell(e), (0, cliHelpers_1.dash)(e.queueLength),
        (0, cliHelpers_1.dash)(e.stats?.tasksCompleted), percent(e.stats?.successRate), (0, cliHelpers_1.fmtNum)(e.stats?.workingHours), (0, cliHelpers_1.dash)(e.stats?.tokens),
        (0, cliHelpers_1.fmtNum)(e.stats?.score), (0, cliHelpers_1.dash)(e.stats?.reworkRejected), (0, cliHelpers_1.dash)(e.stats?.blockedEvents),
    ]));
    return [
        ...head, '', (0, cliHelpers_1.renderTable)(rows, { 1: { truncate: 20 }, 2: { truncate: 20 }, 4: { truncate: 40 } }), '',
        '统计为累计值，只含执行者登记为 emp:<员工id> 的任务；成功率 = 完成 / (完成 + 被驳回 + 阻塞)；说明充分度 = 交给员工的任务说明是否充分（不是员工质量评分）；成本暂无来源，不显示。',
    ].join('\n');
}
exports.renderAiTeam = renderAiTeam;
function renderWorkLog(log) {
    const items = log.items ?? [];
    const size = log.pageSize ?? 0;
    const pages = size > 0 && typeof log.total === 'number' ? Math.max(1, Math.ceil(log.total / size)) : null;
    const head = `AI 员工 #${(0, cliHelpers_1.dash)(log.employeeId)} 工作日志    ${(0, cliHelpers_1.fmtDateTime)(log.from)} → ${(0, cliHelpers_1.fmtDateTime)(log.to)}    共 ${(0, cliHelpers_1.dash)(log.total)} 条，第 ${(0, cliHelpers_1.dash)(log.pageNum)}/${(0, cliHelpers_1.dash)(pages)} 页`;
    if (!items.length)
        return `${head}\n\n该时间范围内没有记录。`;
    const rows = [['时间', '类型', '任务', '详情']].concat(items.map((i) => [
        (0, cliHelpers_1.fmtDateTime)(i.time), LOG_TYPES[i.type ?? ''] ?? (0, cliHelpers_1.dash)(i.type),
        i.taskId ? `#${i.taskId} ${(0, cliHelpers_1.dash)(i.title)}` : (0, cliHelpers_1.dash)(i.title), (0, cliHelpers_1.dash)(i.detail),
    ]));
    return `${head}\n\n${(0, cliHelpers_1.renderTable)(rows, { 2: { truncate: 30 }, 3: { truncate: 80 } })}`;
}
exports.renderWorkLog = renderWorkLog;
/** The overview block: counters + the AI employees needing attention first (`top`). */
function renderAiTeamSummary(s) {
    const top = s.top ?? [];
    const lines = [`共 ${(0, cliHelpers_1.dash)(s.total)}    ${countsLine(s)}`];
    if (top.length) {
        lines.push((0, cliHelpers_1.renderTable)([['名称', '组织', '状态', '当前任务']].concat(top.map((e) => [(0, cliHelpers_1.dash)(e.name), (0, cliHelpers_1.dash)(e.orgName), stateCell(e), tasksCell(e)])), { 3: { truncate: 40 } }));
    }
    return lines.join('\n');
}
exports.renderAiTeamSummary = renderAiTeamSummary;
//# sourceMappingURL=renderAiTeam.js.map