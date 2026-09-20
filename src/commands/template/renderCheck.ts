/** Renderers for dependency checks and the version-upgrade prompt / preview (api-0091 §16, §18). */

import { DASH, dash, renderTable } from '../../utils/cliHelpers';
import { resultLines } from './renderBody';
import { DiffVo, renderDiff } from './renderVersion';

export interface DependencyCheckItem {
  templateId?: number; templateName?: string | null; kind?: string | null; minVersion?: string | null;
  installedVersion?: string | null; publishedVersion?: string | null; status?: string | null; installable?: boolean | null;
  depth?: number | null; requiredBy?: number | null;
}

export interface DependencyCheckVo {
  templateId?: number; version?: string | null; satisfied?: boolean | null; missingRequired?: number | null;
  items?: DependencyCheckItem[] | null; warnings?: string[] | null;
}

const STATUS_LABEL: Record<string, string> = {
  OK: 'OK', MISSING: '缺失', OUTDATED: '过旧', UNAVAILABLE: '不可用',
};

/** Table of the resolved dependency tree; `installable` items are what `--with-deps` would install. */
export function renderDependencyCheck(check: DependencyCheckVo): string[] {
  const items = check.items ?? [];
  const verdict = check.satisfied
    ? '✓ 必需依赖全部满足'
    : `✗ 缺少 ${dash(check.missingRequired)} 个必需依赖（--with-deps 可自动安装其中「可安装」的）`;
  const rows = [['模板', '类型', '最低版本', '已装版本', '最新发布', '状态', '可安装', '深度', '被依赖于']].concat(
    items.map((i) => [
      `#${dash(i.templateId)} ${dash(i.templateName)}`, dash(i.kind), dash(i.minVersion), dash(i.installedVersion), dash(i.publishedVersion),
      i.status ? STATUS_LABEL[i.status] ?? i.status : DASH, i.installable ? '是' : '否', dash(i.depth), `#${dash(i.requiredBy)}`,
    ])
  );
  return [
    `依赖检查: 模板 #${dash(check.templateId)} v${dash(check.version)}  ${verdict}`,
    ...(items.length ? [renderTable(rows, { 0: { truncate: 36 } })] : ['（没有依赖）']),
    ...(check.warnings ?? []).map((w) => `⚠ ${w}`),
  ];
}

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
