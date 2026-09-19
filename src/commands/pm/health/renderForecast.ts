import { DASH, dash, fmtDate, fmtNum, renderTable } from '../../../utils/cliHelpers';
import { downsample, sparkline } from './burnupChart';
import { INSUFFICIENT, basisLabel, block } from './kpi';

/** Renderers for `pm health forecast` and `pm health what-if` (api-0090 §8, §11). */

export interface ForecastSample {
  weekStart?: string | null;
  completed?: number | null;
}

/** `GET /progress/products/{id}/forecast`. status OK | INSUFFICIENT_DATA; on the latter every date / week figure is null. */
export interface Forecast {
  productId?: number | null;
  releaseId?: number | null;
  weightBasis?: string | null;
  status?: string | null;
  message?: string | null;
  asOfDate?: string | null;
  remainingScope?: number | null;
  sampleWeeks?: number | null;
  activeWeeks?: number | null;
  iterations?: number | null;
  horizonWeeks?: number | null;
  p50Weeks?: number | null;
  p80Weeks?: number | null;
  p50Date?: string | null;
  p80Date?: string | null;
  notConverging?: boolean | null;
  plannedEndDate?: string | null;
  p50VarianceDays?: number | null;
  p80VarianceDays?: number | null;
  samples?: ForecastSample[] | null;
}

export const NO_DATA = '数据不足';
const NOT_CONVERGING = '不收敛';

export const releaseLabel = (releaseId?: number | null) => (releaseId ? `  Release #${releaseId}` : '');

/** A forecast figure: never a made-up value — insufficient data says so, a quantile that never converges says so. */
function figure<T>(value: T | null | undefined, insufficient: boolean, notConverging: boolean | null | undefined, render: (v: T) => string): string {
  if (insufficient) return NO_DATA;
  if (value == null) return notConverging ? NOT_CONVERGING : DASH;
  return render(value);
}

const dateFig = (v: string | null | undefined, insufficient: boolean, nc?: boolean | null) => figure(v, insufficient, nc, fmtDate);
const weeksFig = (v: number | null | undefined, insufficient: boolean, nc?: boolean | null) => figure(v, insufficient, nc, (w) => fmtNum(w));

/** Positive = later than planned. */
const vsPlan = (days?: number | null) => (days == null ? DASH : days === 0 ? '与计划持平' : days > 0 ? `晚 ${days} 天` : `早 ${-days} 天`);

export function renderForecast(f: Forecast): string {
  const insufficient = f.status === INSUFFICIENT;
  const nc = f.notConverging;
  const samples = f.samples ?? [];
  const lines = [
    `P50/P80 完成预测  产品 #${dash(f.productId)}${releaseLabel(f.releaseId)}    截至 ${fmtDate(f.asOfDate)}`,
    '─'.repeat(60),
    block([
      ['口径', basisLabel(f.weightBasis)],
      ['剩余范围', fmtNum(f.remainingScope)],
      ['历史样本', `${dash(f.sampleWeeks)} 周（其中有产出 ${dash(f.activeWeeks)} 周）`],
      ['计划结束', fmtDate(f.plannedEndDate)],
    ]),
  ];
  if (insufficient) {
    lines.push('', `⚠ ${NO_DATA}，不给预测日期：${f.message ?? '可度量周不足 4 周或有产出的周不足 2 周'}`);
  }
  lines.push(
    '',
    renderTable([
      ['', 'P50', 'P80'],
      ['预计完成日期', dateFig(f.p50Date, insufficient, nc), dateFig(f.p80Date, insufficient, nc)],
      ['还需周数', weeksFig(f.p50Weeks, insufficient, nc), weeksFig(f.p80Weeks, insufficient, nc)],
      ['相对计划', vsPlan(f.p50VarianceDays), vsPlan(f.p80VarianceDays)],
    ])
  );
  if (nc) lines.push(`⚠ 有分位点在 ${dash(f.horizonWeeks)} 周内无法完成（近期速度趋近 0），该分位不给日期。`);
  if (samples.length) {
    const values = downsample(samples).map((s) => s.completed);
    const ceiling = Math.max(0, ...values.map((v) => v ?? 0));
    lines.push('', `周完成量  ${sparkline(values, ceiling)}  (max ${fmtNum(ceiling)}, ${samples.length} 周: ${fmtDate(samples[0].weekStart)} → ${fmtDate(samples[samples.length - 1].weekStart)})`);
  }
  lines.push(`模拟 ${dash(f.iterations)} 次（种子固定，同一份数据结果不变）；P50 / P80 = 一半 / 80% 的模拟不晚于该日期。`);
  return lines.join('\n');
}

export interface Scenario {
  remaining?: number | null;
  velocity?: number | null;
  p50Weeks?: number | null;
  p80Weeks?: number | null;
  p50Date?: string | null;
  p80Date?: string | null;
  notConverging?: boolean | null;
  estimateAtCompletion?: number | null;
}

export interface DeadlineCheck {
  p50?: boolean | null;
  p80?: boolean | null;
}

export interface CostImpact {
  currency?: string | null;
  baselineEstimateAtCompletion?: number | null;
  scenarioEstimateAtCompletion?: number | null;
  delta?: number | null;
}

/** `POST /progress/products/{id}/what-if`: a pure simulation, nothing is stored. */
export interface WhatIf {
  productId?: number | null;
  releaseId?: number | null;
  weightBasis?: string | null;
  status?: string | null;
  message?: string | null;
  baseline?: Scenario | null;
  scenario?: Scenario | null;
  deltaDays?: number | null;
  deltaDaysP80?: number | null;
  deadline?: string | null;
  meetsDeadline?: DeadlineCheck | null;
  baselineMeetsDeadline?: DeadlineCheck | null;
  costImpact?: CostImpact | null;
  warnings?: string[] | null;
}

/** Negative = earlier than the baseline. */
const shift = (days?: number | null) => (days == null ? DASH : days === 0 ? '不变' : days < 0 ? `提前 ${-days} 天` : `延后 ${days} 天`);
const meets = (v?: boolean | null) => (v == null ? DASH : v ? '✓ 赶得上' : '✗ 赶不上');
const verdict = (c?: DeadlineCheck | null) => `P50 ${meets(c?.p50)}  P80 ${meets(c?.p80)}`;

function scenarioRows(b: Scenario, s: Scenario, insufficient: boolean): string[][] {
  const col = (pick: (x: Scenario) => string): string[] => [pick(b), pick(s)];
  return [
    ['', '基线', '场景'],
    ['剩余范围', ...col((x) => fmtNum(x.remaining))],
    ['周速度（样本均值）', ...col((x) => fmtNum(x.velocity))],
    ['P50 完成', ...col((x) => dateFig(x.p50Date, insufficient, x.notConverging))],
    ['P80 完成', ...col((x) => dateFig(x.p80Date, insufficient, x.notConverging))],
    ['P50 还需周数', ...col((x) => weeksFig(x.p50Weeks, insufficient, x.notConverging))],
    ['P80 还需周数', ...col((x) => weeksFig(x.p80Weeks, insufficient, x.notConverging))],
  ];
}

export function renderWhatIf(w: WhatIf): string {
  const insufficient = w.status === INSUFFICIENT;
  const lines = [
    `What-if 模拟  产品 #${dash(w.productId)}${releaseLabel(w.releaseId)}    口径 ${basisLabel(w.weightBasis)}`,
    '─'.repeat(60),
  ];
  if (insufficient) lines.push(`⚠ ${NO_DATA}，不给预测日期：${w.message ?? '历史周速度样本不足'}`, '');
  lines.push(renderTable(scenarioRows(w.baseline ?? {}, w.scenario ?? {}, insufficient)), '');
  lines.push(`变化   P50 ${shift(w.deltaDays)}    P80 ${shift(w.deltaDaysP80)}`);
  if (w.deadline) {
    lines.push(`目标日期 ${fmtDate(w.deadline)}   基线 ${verdict(w.baselineMeetsDeadline)}   →   场景 ${verdict(w.meetsDeadline)}`);
  }
  const c = w.costImpact;
  if (c) {
    lines.push('', '成本影响（仅反映范围变化）', block([
      ['币种', dash(c.currency)],
      ['基线完工估算', fmtNum(c.baselineEstimateAtCompletion)],
      ['场景完工估算', fmtNum(c.scenarioEstimateAtCompletion)],
      ['差额', fmtNum(c.delta)],
    ]));
  }
  (w.warnings ?? []).forEach((m) => lines.push(`⚠ ${m}`));
  lines.push('', '仅为模拟，不会保存任何数据。');
  return lines.join('\n');
}
