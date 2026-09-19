import { ApiDate, DASH, dash, fmtDate, fmtDateTime, fmtNum, renderTable } from '../../../utils/cliHelpers';
import { basisLabel, block } from './kpi';
import { downsample, progressBar, sparkline } from './burnupChart';

export interface ProgressConfig {
  productId?: number | null;
  configured?: boolean | null;
  weightBasis?: string | null;
  statusCompletion?: Record<string, number> | null;
  effectiveStatusCompletion?: Record<string, number> | null;
  defaultStatusCompletion?: Record<string, number> | null;
  updatedBy?: number | null;
  updatedAt?: ApiDate;
}

export interface ScopeChange {
  id: number;
  productId?: number | null;
  releaseId?: number | null;
  changedAt?: ApiDate;
  deltaScope?: number | null;
  scopeAfter?: number | null;
  weightBasis?: string | null;
  kind?: string | null;
  reason?: string | null;
  addedTaskIds?: number[] | null;
  removedTaskIds?: number[] | null;
  createdBy?: number | null;
}

export interface ScopeChangePage {
  records?: ScopeChange[] | null;
  total?: number | null;
  current?: number | null;
  size?: number | null;
  pages?: number | null;
}

export interface BurnupPoint {
  date?: string | null;
  scope?: number | null;
  completed?: number | null;
  remaining?: number | null;
}

export interface Burnup {
  productId?: number | null;
  releaseId?: number | null;
  weightBasis?: string | null;
  from?: string | null;
  to?: string | null;
  baselineScope?: number | null;
  points?: BurnupPoint[] | null;
}

export interface RebuildResult {
  days?: number | null;
  from?: string | null;
  to?: string | null;
  created?: number | null;
  skipped?: number | null;
}

const signed = (n?: number | null) => (n == null ? DASH : `${n > 0 ? '+' : ''}${fmtNum(n)}`);

export function renderConfig(c: ProgressConfig, saved = false): string {
  const overrides = c.statusCompletion ?? {};
  const effective = c.effectiveStatusCompletion ?? {};
  const defaults = c.defaultStatusCompletion ?? {};
  const statuses = Array.from(new Set([...Object.keys(defaults), ...Object.keys(effective), ...Object.keys(overrides)]));
  const rows = [['状态', '默认', '生效', '覆盖']].concat(
    statuses.map((s) => [s, fmtNum(defaults[s], '%'), fmtNum(effective[s], '%'), fmtNum(overrides[s], '%')])
  );
  return [
    `${saved ? '✓ 已保存  ' : ''}产品进度配置  产品 #${dash(c.productId)}${c.configured ? '' : '    （未配置，使用默认值）'}`,
    '─'.repeat(60),
    block([
      ['工作量口径', basisLabel(c.weightBasis)],
      ['更新', c.updatedAt ? `${fmtDateTime(c.updatedAt)} by ${dash(c.updatedBy)}` : DASH],
    ]),
    '',
    '任务状态完成度',
    renderTable(rows),
    '未列出的状态（paused / blocked）取任务自身进度；completed 恒为 100，cancelled 不计入范围。完成度 = max(状态值, 任务进度)。',
  ].join('\n');
}

const taskCounts = (c: ScopeChange) =>
  c.addedTaskIds?.length || c.removedTaskIds?.length ? `+${c.addedTaskIds?.length ?? 0}/-${c.removedTaskIds?.length ?? 0}` : DASH;

export function renderScopeChanges(page: ScopeChangePage): string {
  const records = page.records ?? [];
  if (!records.length) return '没有范围变更记录。';
  const rows = [['ID', '时间', '类型', '变化', '变更后', '口径', 'Release', '任务', '原因']].concat(
    records.map((c) => [
      String(c.id), fmtDateTime(c.changedAt), dash(c.kind), signed(c.deltaScope), fmtNum(c.scopeAfter), dash(c.weightBasis),
      dash(c.releaseId), taskCounts(c), dash(c.reason),
    ])
  );
  return `${renderTable(rows, { 8: { truncate: 40 } })}\n共 ${dash(page.total)} 条，第 ${dash(page.current)}/${dash(page.pages)} 页`;
}

export function renderScopeChange(c: ScopeChange, verb: string): string {
  return [
    `✓ 范围变更已${verb}  #${c.id}`,
    block([
      ['类型', dash(c.kind)],
      ['变化', `${signed(c.deltaScope)} ${basisLabel(c.weightBasis)}`],
      ['变更后范围', fmtNum(c.scopeAfter)],
      ['Release', dash(c.releaseId)],
      ['原因', dash(c.reason)],
      ['时间', fmtDateTime(c.changedAt)],
    ]),
  ].join('\n');
}

export function renderBurnup(b: Burnup): string {
  const points = b.points ?? [];
  const head = [
    `Burnup  产品 #${dash(b.productId)}${b.releaseId ? `  Release #${b.releaseId}` : ''}    ${fmtDate(b.from)} → ${fmtDate(b.to)}`,
    `口径 ${basisLabel(b.weightBasis)}    基线范围 ${fmtNum(b.baselineScope)}`,
  ];
  if (!points.length) {
    return [...head, '该区间没有快照数据（每日快照 23:50 UTC 生成；可用 `pm health snapshots rebuild` 补齐历史）。'].join('\n');
  }
  const ceiling = Math.max(0, ...points.flatMap((p) => [p.scope ?? 0, p.completed ?? 0]));
  const sampled = downsample(points);
  const rows = [['日期', '范围', '已完成', '剩余', '完成度']].concat(
    points.map((p) => [dash(p.date), fmtNum(p.scope), fmtNum(p.completed), fmtNum(p.remaining), progressBar(p.completed, p.scope)])
  );
  return [
    ...head,
    '',
    `范围   ${sparkline(sampled.map((p) => p.scope), ceiling)}  (max ${fmtNum(ceiling)})`,
    `完成   ${sparkline(sampled.map((p) => p.completed), ceiling)}`,
    '',
    renderTable(rows),
    `共 ${points.length} 个数据点${points.length > sampled.length ? `（上方走势图已抽样为 ${sampled.length} 点）` : ''}`,
  ].join('\n');
}

export function renderRebuild(r: RebuildResult): string {
  return [
    `✓ 快照重建完成  ${dash(r.from)} → ${dash(r.to)}（${dash(r.days)} 天）`,
    block([
      ['新建', dash(r.created)],
      ['已存在（跳过，不覆盖）', dash(r.skipped)],
    ]),
    '注意：已删除的任务无法还原；工作量 / 执行者 / Release 归属取当前值。',
  ].join('\n');
}
