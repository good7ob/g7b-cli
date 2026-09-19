import { ApiDate, DASH, dash, fmtDate, fmtDateTime, fmtNum } from '../../utils/cliHelpers';
import { ScopeKpi, basisLabel, block, renderScopeSections } from '../pm/health/kpi';

/** GET /progress/releases/{id}/health — the shared scope KPIs restricted to one release. */
export interface ReleaseHealth extends ScopeKpi {
  releaseId?: number | null;
  productId?: number | null;
  releaseName?: string | null;
  version?: string | null;
  status?: string | null;
  totalTasks?: number | null;
  completedTasks?: number | null;
  asOf?: ApiDate;
}

/** POST /progress/releases/{id}/baseline */
export interface ReleaseBaseline {
  baselineId?: number | null;
  releaseId?: number | null;
  baselineScope?: number | null;
  baselineTaskCount?: number | null;
  weightBasis?: string | null;
  note?: string | null;
  setBy?: number | null;
  setAt?: ApiDate;
}

export function renderReleaseHealth(h: ReleaseHealth): string {
  const done = h.completedTasks == null || h.totalTasks == null ? DASH : `${h.completedTasks} / ${h.totalTasks}`;
  return [
    `Release 健康  #${dash(h.releaseId)}  ${dash(h.version)}  ${dash(h.releaseName)}    (as of ${fmtDate(h.asOf)})`,
    '─'.repeat(60),
    block([
      ['状态', dash(h.status)],
      ['产品', dash(h.productId)],
      ['任务完成', done],
    ]),
    '',
    ...renderScopeSections(h, `release baseline ${dash(h.releaseId)}`),
  ].join('\n');
}

export function renderReleaseBaseline(b: ReleaseBaseline): string {
  return [
    `✓ 已将 Release #${dash(b.releaseId)} 当前范围设为新基线 #${dash(b.baselineId)}`,
    block([
      ['基线范围', fmtNum(b.baselineScope)],
      ['口径', basisLabel(b.weightBasis)],
      ['任务数', dash(b.baselineTaskCount)],
      ['备注', dash(b.note)],
      ['设置人 / 时间', `${dash(b.setBy)} @ ${fmtDateTime(b.setAt)}`],
    ]),
  ].join('\n');
}
