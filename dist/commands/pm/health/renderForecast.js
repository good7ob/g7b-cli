"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWhatIf = exports.renderForecast = exports.releaseLabel = exports.NO_DATA = void 0;
const cliHelpers_1 = require("../../../utils/cliHelpers");
const burnupChart_1 = require("./burnupChart");
const kpi_1 = require("./kpi");
exports.NO_DATA = '数据不足';
const NOT_CONVERGING = '不收敛';
const releaseLabel = (releaseId) => (releaseId ? `  Release #${releaseId}` : '');
exports.releaseLabel = releaseLabel;
/** A forecast figure: never a made-up value — insufficient data says so, a quantile that never converges says so. */
function figure(value, insufficient, notConverging, render) {
    if (insufficient)
        return exports.NO_DATA;
    if (value == null)
        return notConverging ? NOT_CONVERGING : cliHelpers_1.DASH;
    return render(value);
}
const dateFig = (v, insufficient, nc) => figure(v, insufficient, nc, cliHelpers_1.fmtDate);
const weeksFig = (v, insufficient, nc) => figure(v, insufficient, nc, (w) => (0, cliHelpers_1.fmtNum)(w));
/** Positive = later than planned. */
const vsPlan = (days) => (days == null ? cliHelpers_1.DASH : days === 0 ? '与计划持平' : days > 0 ? `晚 ${days} 天` : `早 ${-days} 天`);
function renderForecast(f) {
    const insufficient = f.status === kpi_1.INSUFFICIENT;
    const nc = f.notConverging;
    const samples = f.samples ?? [];
    const lines = [
        `P50/P80 完成预测  产品 #${(0, cliHelpers_1.dash)(f.productId)}${(0, exports.releaseLabel)(f.releaseId)}    截至 ${(0, cliHelpers_1.fmtDate)(f.asOfDate)}`,
        '─'.repeat(60),
        (0, kpi_1.block)([
            ['口径', (0, kpi_1.basisLabel)(f.weightBasis)],
            ['剩余范围', (0, cliHelpers_1.fmtNum)(f.remainingScope)],
            ['历史样本', `${(0, cliHelpers_1.dash)(f.sampleWeeks)} 周（其中有产出 ${(0, cliHelpers_1.dash)(f.activeWeeks)} 周）`],
            ['计划结束', (0, cliHelpers_1.fmtDate)(f.plannedEndDate)],
        ]),
    ];
    if (insufficient) {
        lines.push('', `⚠ ${exports.NO_DATA}，不给预测日期：${f.message ?? '可度量周不足 4 周或有产出的周不足 2 周'}`);
    }
    lines.push('', (0, cliHelpers_1.renderTable)([
        ['', 'P50', 'P80'],
        ['预计完成日期', dateFig(f.p50Date, insufficient, nc), dateFig(f.p80Date, insufficient, nc)],
        ['还需周数', weeksFig(f.p50Weeks, insufficient, nc), weeksFig(f.p80Weeks, insufficient, nc)],
        ['相对计划', vsPlan(f.p50VarianceDays), vsPlan(f.p80VarianceDays)],
    ]));
    if (nc)
        lines.push(`⚠ 有分位点在 ${(0, cliHelpers_1.dash)(f.horizonWeeks)} 周内无法完成（近期速度趋近 0），该分位不给日期。`);
    if (samples.length) {
        const values = (0, burnupChart_1.downsample)(samples).map((s) => s.completed);
        const ceiling = Math.max(0, ...values.map((v) => v ?? 0));
        lines.push('', `周完成量  ${(0, burnupChart_1.sparkline)(values, ceiling)}  (max ${(0, cliHelpers_1.fmtNum)(ceiling)}, ${samples.length} 周: ${(0, cliHelpers_1.fmtDate)(samples[0].weekStart)} → ${(0, cliHelpers_1.fmtDate)(samples[samples.length - 1].weekStart)})`);
    }
    lines.push(`模拟 ${(0, cliHelpers_1.dash)(f.iterations)} 次（种子固定，同一份数据结果不变）；P50 / P80 = 一半 / 80% 的模拟不晚于该日期。`);
    return lines.join('\n');
}
exports.renderForecast = renderForecast;
/** Negative = earlier than the baseline. */
const shift = (days) => (days == null ? cliHelpers_1.DASH : days === 0 ? '不变' : days < 0 ? `提前 ${-days} 天` : `延后 ${days} 天`);
const meets = (v) => (v == null ? cliHelpers_1.DASH : v ? '✓ 赶得上' : '✗ 赶不上');
const verdict = (c) => `P50 ${meets(c?.p50)}  P80 ${meets(c?.p80)}`;
function scenarioRows(b, s, insufficient) {
    const col = (pick) => [pick(b), pick(s)];
    return [
        ['', '基线', '场景'],
        ['剩余范围', ...col((x) => (0, cliHelpers_1.fmtNum)(x.remaining))],
        ['周速度（样本均值）', ...col((x) => (0, cliHelpers_1.fmtNum)(x.velocity))],
        ['P50 完成', ...col((x) => dateFig(x.p50Date, insufficient, x.notConverging))],
        ['P80 完成', ...col((x) => dateFig(x.p80Date, insufficient, x.notConverging))],
        ['P50 还需周数', ...col((x) => weeksFig(x.p50Weeks, insufficient, x.notConverging))],
        ['P80 还需周数', ...col((x) => weeksFig(x.p80Weeks, insufficient, x.notConverging))],
    ];
}
function renderWhatIf(w) {
    const insufficient = w.status === kpi_1.INSUFFICIENT;
    const lines = [
        `What-if 模拟  产品 #${(0, cliHelpers_1.dash)(w.productId)}${(0, exports.releaseLabel)(w.releaseId)}    口径 ${(0, kpi_1.basisLabel)(w.weightBasis)}`,
        '─'.repeat(60),
    ];
    if (insufficient)
        lines.push(`⚠ ${exports.NO_DATA}，不给预测日期：${w.message ?? '历史周速度样本不足'}`, '');
    lines.push((0, cliHelpers_1.renderTable)(scenarioRows(w.baseline ?? {}, w.scenario ?? {}, insufficient)), '');
    lines.push(`变化   P50 ${shift(w.deltaDays)}    P80 ${shift(w.deltaDaysP80)}`);
    if (w.deadline) {
        lines.push(`目标日期 ${(0, cliHelpers_1.fmtDate)(w.deadline)}   基线 ${verdict(w.baselineMeetsDeadline)}   →   场景 ${verdict(w.meetsDeadline)}`);
    }
    const c = w.costImpact;
    if (c) {
        lines.push('', '成本影响（仅反映范围变化）', (0, kpi_1.block)([
            ['币种', (0, cliHelpers_1.dash)(c.currency)],
            ['基线完工估算', (0, cliHelpers_1.fmtNum)(c.baselineEstimateAtCompletion)],
            ['场景完工估算', (0, cliHelpers_1.fmtNum)(c.scenarioEstimateAtCompletion)],
            ['差额', (0, cliHelpers_1.fmtNum)(c.delta)],
        ]));
    }
    (w.warnings ?? []).forEach((m) => lines.push(`⚠ ${m}`));
    lines.push('', '仅为模拟，不会保存任何数据。');
    return lines.join('\n');
}
exports.renderWhatIf = renderWhatIf;
//# sourceMappingURL=renderForecast.js.map