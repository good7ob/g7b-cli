"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCostEntry = exports.renderCostEntries = exports.renderCost = exports.renderBudget = exports.CATEGORY_LABELS = void 0;
const cliHelpers_1 = require("../../../utils/cliHelpers");
const kpi_1 = require("./kpi");
const renderForecast_1 = require("./renderForecast");
exports.CATEGORY_LABELS = { labor: '人力', cloud: '云资源', ai_token: 'AI token', other: '其他' };
const NO_BUDGET = 'NO_BUDGET';
const money = (v) => (v == null ? cliHelpers_1.DASH : Number(v).toFixed(2));
const category = (c) => (c && exports.CATEGORY_LABELS[c] ? `${c} ${exports.CATEGORY_LABELS[c]}` : (0, cliHelpers_1.dash)(c));
const scopeLabel = (releaseId) => (releaseId ? `Release #${releaseId}` : '产品级');
function renderBudget(b, scope, saved = false) {
    if (!b.configured && !saved) {
        return `${scopeLabel(scope.releaseId)}没有设置预算（产品 #${scope.productId}）。用 good7ob pm health budget set ${scope.productId} --amount <n> --currency <CNY> 设置。`;
    }
    return [
        `${saved ? '✓ 已保存  ' : ''}预算  产品 #${(0, cliHelpers_1.dash)(b.productId ?? scope.productId)}  ${scopeLabel(b.releaseId ?? scope.releaseId)}`,
        (0, kpi_1.block)([
            ['金额', `${money(b.amount)} ${(0, cliHelpers_1.dash)(b.currency)}`],
            ['人力费率', b.laborRatePerHour == null ? `${cliHelpers_1.DASH}（未设置：不推导人力成本）` : `${money(b.laborRatePerHour)} ${(0, cliHelpers_1.dash)(b.currency)} /小时`],
            ['备注', (0, cliHelpers_1.dash)(b.note)],
            ['更新', b.updatedAt ? `${(0, cliHelpers_1.fmtDateTime)(b.updatedAt)} by ${(0, cliHelpers_1.dash)(b.updatedBy)}` : cliHelpers_1.DASH],
        ]),
    ].join('\n');
}
exports.renderBudget = renderBudget;
function renderActual(a) {
    const by = a.byCategory ?? {};
    const keys = Array.from(new Set([...Object.keys(exports.CATEGORY_LABELS), ...Object.keys(by)]));
    const rows = [['类别', '金额（手工录入）']].concat(keys.map((k) => [category(k), money(by[k])]), [['手工合计', money(a.manualTotal)]]);
    const lines = [(0, cliHelpers_1.renderTable)(rows)];
    const d = a.derivedLabor;
    if (d) {
        lines.push(`推导人力（非手工录入）  ${(0, cliHelpers_1.fmtNum)(d.hours)} 小时 × ${money(d.ratePerHour)} /小时 = ${money(d.amount)}`);
    }
    return lines;
}
function renderCost(c) {
    const lines = [
        `成本进度  产品 #${(0, cliHelpers_1.dash)(c.productId)}${(0, renderForecast_1.releaseLabel)(c.releaseId)}    状态 ${(0, cliHelpers_1.dash)(c.status)}    币种 ${(0, cliHelpers_1.dash)(c.currency)}    口径 ${(0, kpi_1.basisLabel)(c.weightBasis)}`,
        '─'.repeat(60),
    ];
    if (c.status === kpi_1.INSUFFICIENT)
        lines.push(`⚠ ${renderForecast_1.NO_DATA}：${c.message ?? '没有成本数据，或同一范围出现多个币种（不求和）'}`);
    if (c.status === NO_BUDGET)
        lines.push('⚠ 该范围没有预算：成本进度 / 完工估算无法计算（`good7ob pm health budget set` 设置预算）；下方仅列已录入的实际成本。');
    lines.push((0, kpi_1.block)([
        ['预算', c.budget?.configured ? money(c.budget.amount) : '未设置'],
        ['实际合计', money(c.actual?.total)],
        ['剩余预算', money(c.remainingBudget)],
    ]));
    if (c.actual)
        lines.push('', ...renderActual(c.actual));
    lines.push('', '进度对比', (0, kpi_1.block)([
        ['开发进度', (0, cliHelpers_1.fmtNum)(c.developmentProgressPct, '%', 1)],
        ['时间进度', (0, cliHelpers_1.fmtNum)(c.timeProgressPct, '%', 1)],
        ['成本进度', (0, cliHelpers_1.fmtNum)(c.costProgressPct, '%', 1)],
        ['成本偏差', c.costVarianceVsProgress == null ? cliHelpers_1.DASH : `${(0, cliHelpers_1.fmtNum)(c.costVarianceVsProgress, ' 个百分点', 1)}（正 = 成本消耗快于交付）`],
    ]), '', '完工估算', (0, kpi_1.block)([
        ['单位范围成本', money(c.costPerScopeUnit)],
        ['完工估算 (EAC)', money(c.estimateAtCompletion)],
        ['EAC 相对预算', money(c.estimateVariance)],
    ]), `AI token 消耗量 ${(0, cliHelpers_1.dash)(c.aiTokensConsumed)}（token 数量，不是金额；ai_token 成本只能手工录入）`);
    (c.warnings ?? []).forEach((w) => lines.push(`⚠ ${w}`));
    return lines.join('\n');
}
exports.renderCost = renderCost;
function renderCostEntries(page) {
    const records = page.records ?? [];
    if (!records.length)
        return '没有成本条目。';
    const rows = [['ID', '日期', '类别', '金额', '币种', 'Release', '来源', '备注']].concat(records.map((e) => [
        String(e.id), (0, cliHelpers_1.dash)(e.incurredOn), category(e.category), money(e.amount), (0, cliHelpers_1.dash)(e.currency), (0, cliHelpers_1.dash)(e.releaseId), (0, cliHelpers_1.dash)(e.source), (0, cliHelpers_1.dash)(e.note),
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 7: { truncate: 40 } })}\n共 ${(0, cliHelpers_1.dash)(page.total)} 条，第 ${(0, cliHelpers_1.dash)(page.current)}/${(0, cliHelpers_1.dash)(page.pages)} 页（source=auto 的条目只读）`;
}
exports.renderCostEntries = renderCostEntries;
function renderCostEntry(e, verb) {
    return [
        `✓ 成本条目已${verb}  #${e.id}`,
        (0, kpi_1.block)([
            ['类别', category(e.category)],
            ['金额', `${money(e.amount)} ${(0, cliHelpers_1.dash)(e.currency)}`],
            ['发生日', (0, cliHelpers_1.dash)(e.incurredOn)],
            ['范围', scopeLabel(e.releaseId)],
            ['来源', (0, cliHelpers_1.dash)(e.source)],
            ['备注', (0, cliHelpers_1.dash)(e.note)],
        ]),
    ].join('\n');
}
exports.renderCostEntry = renderCostEntry;
//# sourceMappingURL=renderCost.js.map