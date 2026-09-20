"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderGenerated = exports.renderCorrection = exports.renderCorrectionTable = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const renderSolutions_1 = require("./renderSolutions");
const DIMENSIONS = [['effort', '人日'], ['cycle', '周期'], ['cost', '成本']];
/** Factor per dimension; < 3 historical samples means factor 1.000 = no correction applied. */
function renderCorrectionTable(c) {
    const rows = [['维度', '系数', '样本数', '说明']].concat(DIMENSIONS.map(([key, label]) => {
        const d = c?.[key];
        const note = !d ? cliHelpers_1.DASH : d.insufficientHistory ? '历史样本不足（<3），未修正' : '已按历史偏差修正';
        return [label, d ? (0, cliHelpers_1.fmtNum)(d.factor, '', 3) : cliHelpers_1.DASH, d ? (0, cliHelpers_1.dash)(d.sampleSize) : cliHelpers_1.DASH, note];
    }));
    return (0, cliHelpers_1.renderTable)(rows);
}
exports.renderCorrectionTable = renderCorrectionTable;
function renderCorrection(c) {
    return [
        `估算修正系数 — 产品 #${(0, cliHelpers_1.dash)(c?.productId)}（系数 = 已完成复盘中 实际 ÷ 预期 的均值，限幅 0.5~3.0，需 ≥3 个样本；新生成的 AI 估算会乘以它）`,
        renderCorrectionTable(c),
    ].join('\n');
}
exports.renderCorrection = renderCorrection;
function renderGenerated(ideaId, result) {
    const solutions = result.solutions ?? [];
    const lines = [
        `✓ 已为 Idea #${ideaId} 生成 ${solutions.length} 个候选方案 [AI 估算]  模型: ${(0, cliHelpers_1.dash)(result.model)}  Token: ${(0, cliHelpers_1.dash)(result.tokensUsed)}`,
        '⚠ 以下人日 / 成本 / 周期均为 AI 估算（已乘以历史修正系数），仅供参考；请人工核对（idea solution update）后再 idea select',
        ...solutions.map((s) => `  #${s.id} ${(0, cliHelpers_1.dash)(s.name)}`),
        ...(0, renderSolutions_1.renderEstimateComparison)(solutions),
    ];
    if (result.correction)
        lines.push('', '本次采用的修正系数:', renderCorrectionTable(result.correction));
    return lines.join('\n');
}
exports.renderGenerated = renderGenerated;
//# sourceMappingURL=aiRender.js.map