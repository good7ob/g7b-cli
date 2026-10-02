import { ApiDate, DASH, dash, fmtDate, fmtNum, renderTable } from '../../utils/cliHelpers';

export interface ReviewExpected {
  solutionId?: number | null;
  solutionName?: string | null;
  effortDays?: number | null;
  cycleWeeks?: number | null;
  cost?: number | null;
  rawEffortDays?: number | null;
  rawCycleWeeks?: number | null;
  rawCost?: number | null;
  kpis?: Array<{ name?: string | null; current?: string | null; target?: string | null; unit?: string | null }> | null;
}

export interface EffectReview {
  id?: number;
  ideaId?: number;
  releaseId?: number | null;
  status?: string | null;
  expected?: ReviewExpected | null;
  actualEffortDays?: number | null;
  actualCycleWeeks?: number | null;
  actualCost?: number | null;
  notes?: string | null;
  reviewedBy?: number | null;
  reviewedAt?: ApiDate;
}

export interface EffectMetric {
  name?: string | null;
  expected?: number | null;
  actual?: number | null;
  unit?: string | null;
  accuracyPct?: number | null;
}

export interface EffectReviewResult {
  review: EffectReview;
  metrics?: EffectMetric[] | null;
  accuracy?: {
    effortAccuracyPct?: number | null;
    scheduleAccuracyPct?: number | null;
    costAccuracyPct?: number | null;
    effectAccuracyPct?: number | null;
  } | null;
}

/** `value（AI 修正前 raw）` — raw only exists for AI solutions. */
const withRaw = (value: number | null | undefined, raw: number | null | undefined, suffix = '') =>
  fmtNum(value, suffix) + (raw !== null && raw !== undefined ? `（AI 修正前 ${fmtNum(raw, suffix)}）` : '');

function renderExpected(e: ReviewExpected | null | undefined): string[] {
  if (!e) return ['预期:     (无：Idea 没有选定方案)'];
  const lines = [
    `预期（选定方案 #${dash(e.solutionId)} ${dash(e.solutionName)}）`,
    `  人日: ${withRaw(e.effortDays, e.rawEffortDays)}    周期: ${withRaw(e.cycleWeeks, e.rawCycleWeeks, ' 周')}    成本: ${withRaw(e.cost, e.rawCost)}`,
  ];
  if (e.kpis?.length) {
    lines.push(`  KPI: ${e.kpis.map((k) => `${dash(k.name)} ${dash(k.current)} → ${dash(k.target)}${k.unit ? ` ${k.unit}` : ''}`).join('；')}`);
  }
  return lines;
}

function renderMetrics(metrics: EffectMetric[]): string {
  if (!metrics.length) return '手工指标: (暂无，用 idea review metrics --metric "name:expected:actual:unit" 填写)';
  const rows = [['指标', '预期', '实际', '单位', '准确度']].concat(
    metrics.map((m) => [dash(m.name), fmtNum(m.expected, '', 4), fmtNum(m.actual, '', 4), dash(m.unit), fmtNum(m.accuracyPct, '%')])
  );
  return `手工指标 (${metrics.length})\n${renderTable(rows)}`;
}

export function renderReview(result: EffectReviewResult): string {
  const r = result.review;
  const a = result.accuracy;
  const done = r.status === 'completed';
  const lines = [
    `效果复盘 — Idea #${dash(r.ideaId)}  状态: ${dash(r.status)}    发布: ${r.releaseId ? `#${r.releaseId}` : DASH}`,
    '─'.repeat(60),
    ...renderExpected(r.expected),
    '实际（自动收集自关联任务；— 表示不可得，不是 0）',
    `  人日: ${fmtNum(r.actualEffortDays)}    周期: ${fmtNum(r.actualCycleWeeks, ' 周')}    成本: ${fmtNum(r.actualCost)}`,
    '  成本口径: 仅人力成本 = 关联任务实际工时 × 预算人力费率（产品预算币种）；没有费率 / 关联任务 / 已记录工时时为 —，成本准确度也随之为 —',
    `准确度（${done ? '完成时冻结' : '草稿为实时计算'}）`,
    `  人日: ${fmtNum(a?.effortAccuracyPct, '%')}    进度: ${fmtNum(a?.scheduleAccuracyPct, '%')}    成本: ${fmtNum(a?.costAccuracyPct, '%')}    效果: ${fmtNum(a?.effectAccuracyPct, '%')}`,
    '',
    renderMetrics(result.metrics ?? []),
  ];
  if (r.notes) lines.push('', '备注:', r.notes);
  if (done) lines.push('', `已完成: ${fmtDate(r.reviewedAt)} by ${dash(r.reviewedBy)}（不可再刷新 / 修改；估算修正系数已重算，见 idea correction）`);
  return lines.join('\n');
}
