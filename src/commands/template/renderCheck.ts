/** Renderers for the version-upgrade prompt / preview (api-0091 §16, §18). */

import { DASH, dash, renderTable } from '../../utils/cliHelpers';
import { resultLines } from './renderBody';
import { DiffVo, renderDiff } from './renderVersion';

export interface UpgradeVo {
  instanceId?: number; templateId?: number; templateName?: string | null; currentVersion?: string | null;
  latestVersion?: string | null; upgradeAvailable?: boolean | null; reason?: string | null; diff?: DiffVo | null; note?: string | null;
}

const DEFAULT_NOTE = '已有实例与它创建的业务对象不会被自动修改；如需使用新版本，请用新版本重新实例化';

export function renderUpgrade(v: UpgradeVo): string {
  const head = `实例 #${dash(v.instanceId)}  模板 #${dash(v.templateId)} ${dash(v.templateName)}  当前 v${dash(v.currentVersion)}  最新已发布 ${v.latestVersion ? `v${v.latestVersion}` : DASH}`;
  const body = v.upgradeAvailable
    ? ['✓ 有新版本可用', ...(v.diff ? ['', renderDiff(v.diff)] : []), '', `预览: good7ob template upgrade ${dash(v.instanceId)} --preview [--var name=value]`]
    : [`✗ 没有可升级的版本${v.reason ? `：${v.reason}` : ''}`];
  return [head, ...body, '', `注意: ${v.note || DEFAULT_NOTE}`].join('\n');
}

export interface UpgradePreviewVo {
  instanceId?: number; from?: string | null; to?: string | null; variables?: Record<string, unknown> | null; renderedContent?: unknown;
}

export function renderUpgradePreview(v: UpgradePreviewVo, writtenTo?: string): string {
  const vars = Object.entries(v.variables ?? {});
  return [
    `升级预览: 实例 #${dash(v.instanceId)}  v${dash(v.from)} → v${dash(v.to)}（仅渲染，未创建任何对象，未修改实例）`,
    ...(vars.length ? [`变量 (${vars.length})`, renderTable([['名称', '值']].concat(vars.map(([k, val]) => [k, dash(val)])), { 1: { truncate: 80 } })] : [`变量: ${DASH}`]),
    '', ...resultLines(v.renderedContent, writtenTo),
    '', `确认后请用新版本重新实例化: good7ob template use <templateId> --version ${dash(v.to)} --org <N> --product <N>`,
  ].join('\n');
}
