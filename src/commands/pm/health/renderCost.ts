import { ApiDate, DASH, dash, fmtDateTime, fmtNum, renderTable } from '../../../utils/cliHelpers';
import { INSUFFICIENT, basisLabel, block } from './kpi';
import { NO_DATA, releaseLabel } from './renderForecast';

/** Renderers for `pm health cost`, `budget` and `cost-entry` (api-0090 §9, §10). Money is shown with 2 decimals. */

export interface Budget {
  configured?: boolean | null;
  id?: number | null;
  productId?: number | null;
  releaseId?: number | null;
  amount?: number | null;
  currency?: string | null;
  laborRatePerHour?: number | null;
  note?: string | null;
  updatedBy?: number | null;
  updatedAt?: ApiDate;
}

export interface CostEntry {
  id: number;
  productId?: number | null;
  releaseId?: number | null;
  category?: string | null;
  amount?: number | null;
  currency?: string | null;
  incurredOn?: string | null;
  note?: string | null;
  source?: string | null;
  createdBy?: number | null;
  createdAt?: ApiDate;
}

export interface CostEntryPage {
  records?: CostEntry[] | null;
  total?: number | null;
  current?: number | null;
  size?: number | null;
  pages?: number | null;
}

export interface DerivedLabor {
  derived?: boolean | null;
  hours?: number | null;
  ratePerHour?: number | null;
  amount?: number | null;
}

/** `GET …/cost`. status OK | NO_BUDGET | INSUFFICIENT_DATA (then `actual` may be null and nothing is summed). */
export interface CostSummary {
  productId?: number | null;
  releaseId?: number | null;
  weightBasis?: string | null;
  status?: string | null;
  message?: string | null;
  currency?: string | null;
  budget?: Budget | null;
  actual?: { byCategory?: Record<string, number | null> | null; manualTotal?: number | null; derivedLabor?: DerivedLabor | null; total?: number | null } | null;
  remainingBudget?: number | null;
  costProgressPct?: number | null;
  developmentProgressPct?: number | null;
  timeProgressPct?: number | null;
  costVarianceVsProgress?: number | null;
  costPerScopeUnit?: number | null;
  estimateAtCompletion?: number | null;
  estimateVariance?: number | null;
  aiTokensConsumed?: number | null;
  warnings?: string[] | null;
}

export const CATEGORY_LABELS: Record<string, string> = { labor: '人力', cloud: '云资源', ai_token: 'AI token', other: '其他' };
const NO_BUDGET = 'NO_BUDGET';

const money = (v?: number | null) => (v == null ? DASH : Number(v).toFixed(2));
const category = (c?: string | null) => (c && CATEGORY_LABELS[c] ? `${c} ${CATEGORY_LABELS[c]}` : dash(c));
const scopeLabel = (releaseId?: number | null) => (releaseId ? `Release #${releaseId}` : '产品级');

export function renderBudget(b: Budget, scope: { productId: number; releaseId?: number | null }, saved = false): string {
  if (!b.configured && !saved) {
    return `${scopeLabel(scope.releaseId)}没有设置预算（产品 #${scope.productId}）。用 good7ob pm health budget set ${scope.productId} --amount <n> --currency <CNY> 设置。`;
  }
  return [
    `${saved ? '✓ 已保存  ' : ''}预算  产品 #${dash(b.productId ?? scope.productId)}  ${scopeLabel(b.releaseId ?? scope.releaseId)}`,
    block([
      ['金额', `${money(b.amount)} ${dash(b.currency)}`],
      ['人力费率', b.laborRatePerHour == null ? `${DASH}（未设置：不推导人力成本）` : `${money(b.laborRatePerHour)} ${dash(b.currency)} /小时`],
      ['备注', dash(b.note)],
      ['更新', b.updatedAt ? `${fmtDateTime(b.updatedAt)} by ${dash(b.updatedBy)}` : DASH],
    ]),
  ].join('\n');
}

function renderActual(a: NonNullable<CostSummary['actual']>): string[] {
  const by = a.byCategory ?? {};
  const keys = Array.from(new Set([...Object.keys(CATEGORY_LABELS), ...Object.keys(by)]));
  const rows = [['类别', '金额（手工录入）']].concat(keys.map((k) => [category(k), money(by[k])]), [['手工合计', money(a.manualTotal)]]);
  const lines = [renderTable(rows)];
  const d = a.derivedLabor;
  if (d) {
    lines.push(`推导人力（非手工录入）  ${fmtNum(d.hours)} 小时 × ${money(d.ratePerHour)} /小时 = ${money(d.amount)}`);
  }
  return lines;
}

export function renderCost(c: CostSummary): string {
  const lines = [
    `成本进度  产品 #${dash(c.productId)}${releaseLabel(c.releaseId)}    状态 ${dash(c.status)}    币种 ${dash(c.currency)}    口径 ${basisLabel(c.weightBasis)}`,
    '─'.repeat(60),
  ];
  if (c.status === INSUFFICIENT) lines.push(`⚠ ${NO_DATA}：${c.message ?? '没有成本数据，或同一范围出现多个币种（不求和）'}`);
  if (c.status === NO_BUDGET) lines.push('⚠ 该范围没有预算：成本进度 / 完工估算无法计算（`good7ob pm health budget set` 设置预算）；下方仅列已录入的实际成本。');
  lines.push(block([
    ['预算', c.budget?.configured ? money(c.budget.amount) : '未设置'],
    ['实际合计', money(c.actual?.total)],
    ['剩余预算', money(c.remainingBudget)],
  ]));
  if (c.actual) lines.push('', ...renderActual(c.actual));
  lines.push(
    '',
    '进度对比',
    block([
      ['开发进度', fmtNum(c.developmentProgressPct, '%', 1)],
      ['时间进度', fmtNum(c.timeProgressPct, '%', 1)],
      ['成本进度', fmtNum(c.costProgressPct, '%', 1)],
      ['成本偏差', c.costVarianceVsProgress == null ? DASH : `${fmtNum(c.costVarianceVsProgress, ' 个百分点', 1)}（正 = 成本消耗快于交付）`],
    ]),
    '',
    '完工估算',
    block([
      ['单位范围成本', money(c.costPerScopeUnit)],
      ['完工估算 (EAC)', money(c.estimateAtCompletion)],
      ['EAC 相对预算', money(c.estimateVariance)],
    ]),
    `AI token 消耗量 ${dash(c.aiTokensConsumed)}（token 数量，不是金额；ai_token 成本只能手工录入）`,
  );
  (c.warnings ?? []).forEach((w) => lines.push(`⚠ ${w}`));
  return lines.join('\n');
}

export function renderCostEntries(page: CostEntryPage): string {
  const records = page.records ?? [];
  if (!records.length) return '没有成本条目。';
  const rows = [['ID', '日期', '类别', '金额', '币种', 'Release', '来源', '备注']].concat(
    records.map((e) => [
      String(e.id), dash(e.incurredOn), category(e.category), money(e.amount), dash(e.currency), dash(e.releaseId), dash(e.source), dash(e.note),
    ])
  );
  return `${renderTable(rows, { 7: { truncate: 40 } })}\n共 ${dash(page.total)} 条，第 ${dash(page.current)}/${dash(page.pages)} 页（source=auto 的条目只读）`;
}

export function renderCostEntry(e: CostEntry, verb: string): string {
  return [
    `✓ 成本条目已${verb}  #${e.id}`,
    block([
      ['类别', category(e.category)],
      ['金额', `${money(e.amount)} ${dash(e.currency)}`],
      ['发生日', dash(e.incurredOn)],
      ['范围', scopeLabel(e.releaseId)],
      ['来源', dash(e.source)],
      ['备注', dash(e.note)],
    ]),
  ].join('\n');
}
