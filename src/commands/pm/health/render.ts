import { ApiDate, DASH, dash, fmtDate, fmtNum, renderTable } from '../../../utils/cliHelpers';
import { ScopeKpi, basisLabel, block, renderScopeSections } from './kpi';

/** Fields the backend cannot always compute are nullable — rendered as "—", never 0. */
export interface ProductHealth extends ScopeKpi {
  productId?: number | null;
  productName?: string | null;
  overallProgress?: number | null;
  plannedProgress?: number | null;
  scheduleVariance?: number | null;
  remainingWork?: number | null;
  totalTasks?: number | null;
  completedTasks?: number | null;
  riskLevel?: string | null;
  moduleCount?: number | null;
  asOf?: ApiDate;
}

export interface ModuleHealth {
  projectId?: number | null;
  moduleName?: string | null;
  ownerId?: number | null;
  ownerName?: string | null;
  actualProgress?: number | null;
  plannedProgress?: number | null;
  progressVariance?: number | null;
  delayDays?: number | null;
  expectedEndDate?: ApiDate;
  riskLevel?: string | null;
  totalTasks?: number | null;
  completedTasks?: number | null;
  blockedTasks?: number | null;
  weightedProgress?: number | null;
  /** Only the basis is per-module; the other new KPI fields exist on the product response. */
  weightBasis?: string | null;
}

export interface Baseline {
  baselineId?: number | null;
  productId?: number | null;
  baselineScopeWeight?: number | null;
  baselineTaskCount?: number | null;
  note?: string | null;
  setBy?: number | null;
  setAt?: ApiDate;
}

export function renderHealth(h: ProductHealth): string {
  const done = h.completedTasks == null || h.totalTasks == null ? DASH : `${h.completedTasks} / ${h.totalTasks}`;
  return [
    `产品健康  #${dash(h.productId)}  ${dash(h.productName)}    (as of ${fmtDate(h.asOf)})`,
    '─'.repeat(60),
    block([
      ['风险等级', dash(h.riskLevel)],
      ['模块数', dash(h.moduleCount)],
      ['任务完成', done],
      ['剩余任务', dash(h.remainingWork)],
      ['整体进度', fmtNum(h.overallProgress, '%', 1)],
      ['计划进度', fmtNum(h.plannedProgress, '%', 1)],
      ['进度偏差', fmtNum(h.scheduleVariance, '%', 1)],
    ]),
    '',
    ...renderScopeSections(h, `pm health baseline ${dash(h.productId)}`),
  ].join('\n');
}

export function renderModules(modules: ModuleHealth[]): string {
  if (!modules.length) return '该产品下没有模块。';
  const pair = (a?: number | null, b?: number | null) => (a == null || b == null ? DASH : `${a}/${b}`);
  const rows = [['模块', '负责人', '实际', '计划', '偏差', '延期天', '加权', '预计完成', '风险', '完成/总', '阻塞']].concat(
    modules.map((m) => [
      dash(m.moduleName), dash(m.ownerName ?? m.ownerId), fmtNum(m.actualProgress, '%', 1), fmtNum(m.plannedProgress, '%', 1),
      fmtNum(m.progressVariance, '%', 1), dash(m.delayDays), fmtNum(m.weightedProgress, '%'), fmtDate(m.expectedEndDate),
      dash(m.riskLevel), pair(m.completedTasks, m.totalTasks), dash(m.blockedTasks),
    ])
  );
  const basis = modules.find((m) => m.weightBasis)?.weightBasis;
  const footer = `共 ${modules.length} 个模块（按延期天数降序）${basis ? `；加权进度口径 ${basisLabel(basis)}` : ''}`;
  return `${renderTable(rows, { 0: { truncate: 28 } })}\n${footer}`;
}

export function renderBaseline(b: Baseline): string {
  return [
    `✓ 已将当前范围设为新基线 #${dash(b.baselineId)}`,
    block([
      ['产品', dash(b.productId)],
      ['基线范围', fmtNum(b.baselineScopeWeight)],
      ['任务数', dash(b.baselineTaskCount)],
      ['备注', dash(b.note)],
      ['设置人 / 时间', `${dash(b.setBy)} @ ${fmtDate(b.setAt)}`],
    ]),
  ].join('\n');
}
