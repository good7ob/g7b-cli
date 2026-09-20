"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderOrgs = exports.renderProducts = exports.productTable = exports.renderMyTasks = exports.renderTaskGroup = exports.renderTaskCounts = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const GROUP_LABELS = {
    today: '今日', todo: '待开始', inProgress: '进行中', waiting: '等待中', blocked: '已阻塞', done: '已完成',
};
const SUMMARY_LABELS = { today: '今日', inProgress: '进行中', awaiting: '待审批', overdue: '已逾期' };
const labelled = (labels, values) => Object.keys(labels).map((k) => `${labels[k]} ${(0, cliHelpers_1.dash)(values?.[k])}`).join('  ');
/** `今日 5  待开始 3 …` — groups overlap, so these never add up to a total. */
const renderTaskCounts = (counts) => labelled(GROUP_LABELS, counts);
exports.renderTaskCounts = renderTaskCounts;
function taskTable(items) {
    const rows = [['ID', '名称', '状态', '优先级', '截止', '项目', '进度', '执行者']].concat(items.map((t) => [
        (0, cliHelpers_1.dash)(t.id), (0, cliHelpers_1.dash)(t.name), (0, cliHelpers_1.dash)(t.status), (0, cliHelpers_1.dash)(t.priority), (0, cliHelpers_1.fmtDateTime)(t.deadline),
        (0, cliHelpers_1.dash)(t.projectName ?? t.projectId), (0, cliHelpers_1.fmtNum)(t.progress, '%', 0), (0, cliHelpers_1.dash)(t.executorType),
    ]));
    return (0, cliHelpers_1.renderTable)(rows, { 1: { truncate: 40 }, 5: { truncate: 20 } });
}
function renderTaskGroup(vo) {
    const items = vo.items ?? [];
    const pageNum = vo.pageNum ?? 1;
    const pageSize = vo.pageSize ?? 20;
    const total = typeof vo.total === 'number' ? vo.total : items.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const lines = [`分组: ${(0, cliHelpers_1.dash)(vo.group)}  共 ${total} 条，第 ${pageNum}/${pages} 页`, (0, exports.renderTaskCounts)(vo.counts)];
    if (!items.length)
        return [...lines, '', '该分组没有任务。'].join('\n');
    lines.push('', taskTable(items));
    if (pageNum < pages)
        lines.push(`下一页: --page ${pageNum + 1}`);
    return lines.join('\n');
}
exports.renderTaskGroup = renderTaskGroup;
function renderMyTasks(vo) {
    const items = vo.items ?? [];
    const lines = [`我的开放任务: ${(0, cliHelpers_1.dash)(vo.total)}`, labelled(SUMMARY_LABELS, vo.summary)];
    if (!items.length)
        return [...lines, '', '没有开放任务。'].join('\n');
    lines.push('', taskTable(items));
    if (typeof vo.total === 'number' && vo.total > items.length) {
        lines.push(`显示最紧急的 ${items.length} / ${vo.total} 条（用 --limit 调大，最大 50；或用 --group 分页浏览）`);
    }
    return lines.join('\n');
}
exports.renderMyTasks = renderMyTasks;
const relation = (p) => {
    const tags = [p.owned && '创建', p.participating && '参与', p.following && '关注'].filter(Boolean);
    return tags.length ? tags.join('/') : cliHelpers_1.DASH;
};
const NOT_EVALUATED_NOTE = '进度 / 风险只评估前 20 张卡片，其余显示 —';
/** Product cards as a table; `progress`/`riskLevel` are null for cards the backend did not evaluate (noted below the table). */
function productTable(items) {
    const rows = [['产品ID', '产品', '组织', '状态', '关系', '我的任务', '阻塞', 'AI进行中', '进度', '风险']].concat(items.map((p) => [
        (0, cliHelpers_1.dash)(p.productId), (0, cliHelpers_1.dash)(p.name), (0, cliHelpers_1.dash)(p.orgName ?? p.orgId), (0, cliHelpers_1.dash)(p.status), relation(p),
        (0, cliHelpers_1.dash)(p.myOpenTasks), (0, cliHelpers_1.dash)(p.blockedCount), (0, cliHelpers_1.dash)(p.aiWorkingCount), (0, cliHelpers_1.fmtNum)(p.progress, '%', 1), (0, cliHelpers_1.dash)(p.riskLevel),
    ]));
    const table = (0, cliHelpers_1.renderTable)(rows, { 1: { truncate: 30 }, 2: { truncate: 20 } });
    return items.some((p) => p.progress === null || p.progress === undefined) ? `${table}\n${NOT_EVALUATED_NOTE}` : table;
}
exports.productTable = productTable;
function renderProducts(vo) {
    const items = vo.items ?? [];
    const head = `范围: ${(0, cliHelpers_1.dash)(vo.scope)}  共 ${(0, cliHelpers_1.dash)(vo.total)} 个产品`;
    if (!items.length)
        return `${head}\n\n没有产品。`;
    return [head, '', productTable(items)].join('\n');
}
exports.renderProducts = renderProducts;
function renderOrgs(vo) {
    const items = vo.items ?? [];
    if (!items.length)
        return '你还不是任何组织的成员。';
    const rows = [['组织ID', '名称', '我的角色', '成员', 'AI员工', '产品', '活跃任务']].concat(items.map((o) => [
        (0, cliHelpers_1.dash)(o.orgId), (0, cliHelpers_1.dash)(o.name), (0, cliHelpers_1.dash)(o.myRole), (0, cliHelpers_1.dash)(o.memberCount), (0, cliHelpers_1.dash)(o.aiEmployeeCount),
        (0, cliHelpers_1.dash)(o.productCount), (0, cliHelpers_1.dash)(o.activeTaskCount),
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 1: { truncate: 30 } })}\n共 ${(0, cliHelpers_1.dash)(vo.total)} 个组织`;
}
exports.renderOrgs = renderOrgs;
//# sourceMappingURL=renderViews.js.map