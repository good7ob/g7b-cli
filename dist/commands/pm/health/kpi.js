"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderScopeSections = exports.etaLabel = exports.block = exports.basisLabel = exports.INSUFFICIENT = void 0;
const cliHelpers_1 = require("../../../utils/cliHelpers");
const UNITS = { ESTIMATED_HOURS: 'h', STORY_POINT: 'SP', WEIGHT: '权重' };
exports.INSUFFICIENT = 'INSUFFICIENT_DATA';
/** `ESTIMATED_HOURS (h)`; unknown/absent basis -> the raw value or "—". */
function basisLabel(basis) {
    return basis && UNITS[basis] ? `${basis} (${UNITS[basis]})` : (0, cliHelpers_1.dash)(basis);
}
exports.basisLabel = basisLabel;
/** Label/value block; `table` measures CJK width so the values line up. */
const block = (rows) => (0, cliHelpers_1.renderTable)(rows);
exports.block = block;
const perWeek = (v) => (v == null ? cliHelpers_1.DASH : `${(0, cliHelpers_1.fmtNum)(v)} /周`);
/** INSUFFICIENT_DATA is "数据不足", never a made-up date; a missing date is "—". */
function etaLabel(k) {
    if (k.velocityDataStatus === exports.INSUFFICIENT)
        return '数据不足';
    return k.estimatedCompletionDate ? (0, cliHelpers_1.fmtDate)(k.estimatedCompletionDate) : cliHelpers_1.DASH;
}
exports.etaLabel = etaLabel;
/**
 * The sections after the entity-specific head. `rebaselineHint` is the command that re-sets the
 * baseline for this entity, shown when the baseline is in another unit than the current basis.
 */
function renderScopeSections(k, rebaselineHint) {
    const lines = [
        '工作量口径',
        (0, exports.block)([
            ['口径', basisLabel(k.weightBasis)],
            ['回退任务数', (0, cliHelpers_1.dash)(k.basisFallbackTaskCount)],
            ['已完成范围', (0, cliHelpers_1.fmtNum)(k.completedScopeWeight)],
            ['剩余范围', (0, cliHelpers_1.fmtNum)(k.remainingScopeWeight)],
            ['等价完成量', (0, cliHelpers_1.fmtNum)(k.earnedWeight)],
        ]),
    ];
    if ((k.basisFallbackTaskCount ?? 0) > 0) {
        lines.push(`⚠ ${k.basisFallbackTaskCount} 个任务缺少 ${(0, cliHelpers_1.dash)(k.weightBasis)} 的取值，已回退到下一级口径（单位混合，数字仅供参考）`);
    }
    lines.push('', '范围与基线', (0, exports.block)([
        ['当前范围', (0, cliHelpers_1.fmtNum)(k.currentScopeWeight)],
        ['基线范围', (0, cliHelpers_1.fmtNum)(k.baselineScopeWeight)],
        ['基线口径', basisLabel(k.baselineWeightBasis)],
        ['范围变化', (0, cliHelpers_1.fmtNum)(k.scopeChange)],
        ['范围增长', (0, cliHelpers_1.fmtNum)(k.scopeGrowthPct, '%', 1)],
        ['基线进度', (0, cliHelpers_1.fmtNum)(k.baselineProgressPct, '%', 1)],
        ['基线时间', (0, cliHelpers_1.fmtDate)(k.baselineSetAt)],
    ]));
    if (k.baselineBasisMismatch) {
        lines.push(`⚠ 基线口径 ${(0, cliHelpers_1.dash)(k.baselineWeightBasis)} 与当前口径 ${(0, cliHelpers_1.dash)(k.weightBasis)} 不同：基线范围 / 范围变化 / 范围增长 / 基线进度 的单位是 ${(0, cliHelpers_1.dash)(k.baselineWeightBasis)}。` +
            `重设基线即可迁到当前口径（${rebaselineHint}）`);
    }
    lines.push('', '加权进度与阻塞', (0, exports.block)([
        ['加权进度', (0, cliHelpers_1.fmtNum)(k.weightedProgress, '%')],
        ['阻塞权重', (0, cliHelpers_1.fmtNum)(k.blockedWeight)],
        ['阻塞占比', (0, cliHelpers_1.fmtNum)(k.blockedWeightRatio, '%', 1)],
    ]), '', 'AI 贡献', (0, exports.block)([
        ['AI 完成权重', (0, cliHelpers_1.fmtNum)(k.aiCompletedWeight)],
        ['人工完成权重', (0, cliHelpers_1.fmtNum)(k.humanCompletedWeight)],
        ['AI 占比', (0, cliHelpers_1.fmtNum)(k.aiContributionPct, '%', 1)],
    ]), '', '速度与预测', (0, exports.block)([
        ['近 4 周速度', perWeek(k.velocity4w)],
        ['近 8 周速度', perWeek(k.velocity8w)],
        ['预计完成', etaLabel(k)],
        ['速度数据', (0, cliHelpers_1.dash)(k.velocityDataStatus)],
    ]));
    return lines;
}
exports.renderScopeSections = renderScopeSections;
//# sourceMappingURL=kpi.js.map