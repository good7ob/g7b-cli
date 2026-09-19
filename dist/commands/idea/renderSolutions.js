"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderSolutions = exports.renderDecision = exports.renderEstimateComparison = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const ESTIMATE_KEYS = [
    'effortDaysFrontend', 'effortDaysBackend', 'effortDaysAi', 'effortDaysTest', 'effortDaysPm', 'totalEffortDays',
    'estimatedCost', 'cloudCostMonthly', 'aiTokenCostMonthly', 'maintenanceCost', 'cycleWeeks', 'technicalRisk',
    'productRisk', 'expectedEffect', 'kpi', 'confidence', 'rejectionReason',
];
const hasValue = (v) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
const hasEstimate = (s) => ESTIMATE_KEYS.some((k) => hasValue(s[k])) || s.estimationSource === 'ai';
function fmtKpi(k) {
    const unit = k.unit ? ` ${k.unit}` : '';
    return `${(0, cliHelpers_1.dash)(k.name)}: ${(0, cliHelpers_1.dash)(k.current)} → ${(0, cliHelpers_1.dash)(k.target)}${unit}`;
}
/** [row label, cell for one solution] — rendered transposed so solutions sit side by side. */
const ESTIMATE_ROWS = [
    ['总人日', (s) => (0, cliHelpers_1.fmtNum)(s.totalEffortDays)],
    ['人日明细', (s) => [`前端 ${(0, cliHelpers_1.fmtNum)(s.effortDaysFrontend)}`, `后端 ${(0, cliHelpers_1.fmtNum)(s.effortDaysBackend)}`, `AI ${(0, cliHelpers_1.fmtNum)(s.effortDaysAi)}`, `测试 ${(0, cliHelpers_1.fmtNum)(s.effortDaysTest)}`, `PM ${(0, cliHelpers_1.fmtNum)(s.effortDaysPm)}`].join('\n')],
    ['预计成本', (s) => (0, cliHelpers_1.fmtNum)(s.estimatedCost)],
    ['月度成本', (s) => [`云 ${(0, cliHelpers_1.fmtNum)(s.cloudCostMonthly)}`, `Token ${(0, cliHelpers_1.fmtNum)(s.aiTokenCostMonthly)}`, `维护 ${(0, cliHelpers_1.fmtNum)(s.maintenanceCost)}`].join('\n')],
    ['周期', (s) => (0, cliHelpers_1.fmtNum)(s.cycleWeeks, ' 周')],
    ['技术风险', (s) => (0, cliHelpers_1.dash)(s.technicalRisk)],
    ['产品风险', (s) => (0, cliHelpers_1.dash)(s.productRisk)],
    ['可信度', (s) => `${(0, cliHelpers_1.dash)(s.confidence)}${s.estimationSource === 'ai' ? ' [AI 估算]' : ''}`],
    ['预期效果', (s) => (0, cliHelpers_1.dash)(s.expectedEffect)],
    ['KPI', (s) => (s.kpi?.length ? s.kpi.map(fmtKpi).join('\n') : (0, cliHelpers_1.dash)(null))],
    ['落选原因', (s) => (0, cliHelpers_1.dash)(s.rejectionReason)],
];
/** Solutions as columns, estimate dimensions as rows. Empty when no solution carries any estimate. */
function renderEstimateComparison(solutions) {
    if (!solutions.some(hasEstimate))
        return [];
    const wrap = { width: 26, wrapWord: false };
    const header = [''].concat(solutions.map((s) => `#${s.id} ${(0, cliHelpers_1.dash)(s.name)}${s.isSelected ? ' ✓' : ''}`));
    const rows = [header].concat(ESTIMATE_ROWS.map(([label, cell]) => [label, ...solutions.map(cell)]));
    const columns = Object.fromEntries(solutions.map((_, i) => [i + 1, wrap]));
    return ['', '估算对比（月度成本均为每月）', (0, cliHelpers_1.renderTable)(rows, columns)];
}
exports.renderEstimateComparison = renderEstimateComparison;
/** Decision line: from the decision row when there is one, else from the solution flagged selected (MVP). */
function renderDecision(solutions, decision) {
    if (decision?.selectedSolutionId) {
        const chosen = solutions.find((s) => s.id === decision.selectedSolutionId);
        const approval = decision.approvalStatus ? `；审批: ${decision.approvalStatus}${decision.approvalId ? ` (审批单 #${decision.approvalId})` : ''}` : '';
        return [`决策: 选定 #${decision.selectedSolutionId} ${(0, cliHelpers_1.dash)(chosen?.name)} — ${(0, cliHelpers_1.dash)(decision.reason)}（by ${(0, cliHelpers_1.dash)(decision.decidedBy)} @ ${(0, cliHelpers_1.fmtDate)(decision.decidedAt)}）${approval}`];
    }
    return solutions.filter((s) => s.isSelected).map((s) => `决策: 选定 #${s.id} ${(0, cliHelpers_1.dash)(s.name)} — ${(0, cliHelpers_1.dash)(s.decisionReason)}（by ${(0, cliHelpers_1.dash)(s.decidedBy)} @ ${(0, cliHelpers_1.fmtDate)(s.decidedAt)}）`);
}
exports.renderDecision = renderDecision;
function renderSolutions(solutions, decision) {
    if (!solutions.length)
        return ['方案: (暂无方案，用 idea solution add 添加)'];
    const wrap = { width: 22, wrapWord: false };
    const rows = [['ID', '方案', '成本', '周期', '预期效果', '选中']].concat(solutions.map((s) => [
        String(s.id), (0, cliHelpers_1.dash)(s.name), (0, cliHelpers_1.dash)(s.costNote), (0, cliHelpers_1.dash)(s.cycleNote), (0, cliHelpers_1.dash)(s.expectedEffectNote),
        s.isSelected ? '✓' : '',
    ]));
    return [
        `方案 (${solutions.length})`,
        (0, cliHelpers_1.renderTable)(rows, { 1: wrap, 2: wrap, 3: wrap, 4: wrap }),
        ...renderEstimateComparison(solutions),
        ...renderDecision(solutions, decision),
    ];
}
exports.renderSolutions = renderSolutions;
//# sourceMappingURL=renderSolutions.js.map