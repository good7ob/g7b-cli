/**
 * Renderers for installs, instances and package instantiation. Every value may be null (the backend drops null
 * fields), shown as "—"; rendered content is untrusted user text: printed as text only (`emit` strips control chars).
 */

import { ApiDate, DASH, dash, fmtDateTime, renderTable } from '../../utils/cliHelpers';
import { extractRecords } from '../../utils/extractRecords';
import { pageFooter } from './render';
import { DependencyCheckVo, renderDependencyCheck } from './renderCheck';
import { documentBody, resultLines } from './renderBody';

export interface CreatedObject {
  type?: string | null; id?: number | null; name?: string | null; ref?: string | null;
}

export interface InstanceVo {
  id?: number; templateId?: number; templateName?: string | null; templateType?: string | null; versionId?: number | null;
  version?: string | null; installationId?: number | null; orgId?: number | null; productId?: number | null;
  packageId?: number | null; variables?: Record<string, unknown> | null; renderedContent?: unknown;
  createdObjectType?: string | null; createdObjectId?: number | null; createdObjects?: CreatedObject[] | null;
  warnings?: string[] | null; status?: string | null; createdBy?: number | null; createdAt?: ApiDate;
}

export interface InstallationVo {
  id?: number; templateId?: number; templateName?: string | null; templateType?: string | null; templateStatus?: string | null;
  orgId?: number | null; versionId?: number | null; version?: string | null; publishedVersion?: string | null;
  upgradeAvailable?: boolean | null; installedAt?: ApiDate; updatedAt?: ApiDate; created?: boolean | null;
  dependencies?: DependencyCheckVo | null;
}

export interface PackageInstantiationVo {
  packageId?: number; packageName?: string | null; instances?: InstanceVo[] | null; createdObjectCount?: number | null;
  warnings?: string[] | null;
}

/** Long object lists (a task template makes up to 200) are cut in a terminal; `--json` has all of them. */
const OBJECT_ROWS = 60;

const scope = (orgId: number | null | undefined) => (orgId ? `组织 #${orgId}` : '个人范围');
const warningLines = (warnings: string[] | null | undefined) => (warnings ?? []).map((w) => `⚠ ${w}`);

export function renderCreatedObjects(objects: CreatedObject[] | null | undefined): string[] {
  const list = objects ?? [];
  if (!list.length) return [`创建的对象: ${DASH}`];
  const rows = [['类型', 'ID', '名称', '引用']].concat(list.slice(0, OBJECT_ROWS).map((o) => [dash(o.type), dash(o.id), dash(o.name), dash(o.ref)]));
  const more = list.length > OBJECT_ROWS ? [`… 共 ${list.length} 个，已省略 ${list.length - OBJECT_ROWS} 个（完整列表用 --json）`] : [];
  return [`创建的对象 (${list.length})`, renderTable(rows, { 2: { truncate: 50 } }), ...more];
}

function renderVariableValues(variables: Record<string, unknown> | null | undefined): string[] {
  const entries = Object.entries(variables ?? {});
  if (!entries.length) return [`变量: ${DASH}`];
  const rows = [['名称', '值']].concat(entries.map(([name, value]) => [name, dash(value)]));
  return [`变量 (${entries.length})`, renderTable(rows, { 1: { truncate: 80 } })];
}

function instanceHeader(v: InstanceVo): string[] {
  return [
    `实例 #${dash(v.id)} [${dash(v.status)}]  模板 #${dash(v.templateId)} ${dash(v.templateName)} (${dash(v.templateType)} v${dash(v.version)})`,
    `目标:     ${scope(v.orgId)}  产品 #${dash(v.productId)}    产出: ${dash(v.createdObjectType)}${v.createdObjectId ? ` #${v.createdObjectId}` : ''}${v.packageId ? `    模板包 #${v.packageId}` : ''}`,
    `创建:     ${fmtDateTime(v.createdAt)} by ${dash(v.createdBy)}`,
  ];
}

/** Result of `template use`. */
export function renderInstantiated(v: InstanceVo, writtenTo?: string): string {
  const head = instanceHeader(v);
  return [
    `✓ 已实例化: ${head[0]}`, ...head.slice(1), '',
    ...renderCreatedObjects(v.createdObjects), ...warningLines(v.warnings),
    ...(documentBody(v.renderedContent) || writtenTo ? ['', ...resultLines(v.renderedContent, writtenTo)] : []),
    '', `后续: good7ob template instance ${dash(v.id)} 查看；模板有新版本时 good7ob template upgrade ${dash(v.id)}`,
  ].join('\n');
}

/** `template instance <id>`. */
export function renderInstance(v: InstanceVo, writtenTo?: string): string {
  return [
    ...instanceHeader(v), '', ...renderVariableValues(v.variables), '', ...renderCreatedObjects(v.createdObjects),
    '', ...resultLines(v.renderedContent, writtenTo),
  ].join('\n').trimEnd();
}

export function renderInstanceList(result: unknown, pageNum: number, pageSize: number): string {
  const records = extractRecords<InstanceVo>(result);
  if (!records.length) return '还没有实例。';
  const rows = [['ID', '状态', '类型', '模板', '版本', '组织', '产品', '产出', '包', '创建时间']].concat(
    records.map((v) => [
      dash(v.id), dash(v.status), dash(v.templateType), `#${dash(v.templateId)} ${dash(v.templateName)}`, dash(v.version),
      dash(v.orgId), dash(v.productId), v.createdObjectType ? `${v.createdObjectType}${v.createdObjectId ? ` #${v.createdObjectId}` : ''}` : DASH,
      dash(v.packageId), fmtDateTime(v.createdAt),
    ])
  );
  return `${renderTable(rows, { 3: { truncate: 36 } })}\n${pageFooter(result, records, pageNum, pageSize)}`;
}

/** Result of `template package use`: one line per instance, then the total. */
export function renderPackageInstantiation(v: PackageInstantiationVo): string {
  const instances = v.instances ?? [];
  const rows = [['实例', '模板', '类型', '版本', '产出', '对象数']].concat(
    instances.map((i) => [
      `#${dash(i.id)}`, `#${dash(i.templateId)} ${dash(i.templateName)}`, dash(i.templateType), dash(i.version),
      i.createdObjectType ? `${i.createdObjectType}${i.createdObjectId ? ` #${i.createdObjectId}` : ''}` : DASH, String(i.createdObjects?.length ?? 0),
    ])
  );
  return [
    `✓ 已实例化模板包 #${dash(v.packageId)} ${dash(v.packageName)}: ${instances.length} 个实例，共创建 ${dash(v.createdObjectCount)} 个对象（整包一个事务）`,
    ...(instances.length ? [renderTable(rows, { 1: { truncate: 36 } })] : []), ...warningLines(v.warnings),
    '', '查看某个实例的对象 / 文档: good7ob template instance <实例 ID>',
  ].join('\n');
}

// ── installs ──

export function renderInstalled(v: InstallationVo): string {
  const name = v.templateName ? `${v.templateName} ` : '';
  const state = v.created ? '已安装' : '已是安装状态（未变化）';
  return [
    `✓ ${state}: 模板 #${dash(v.templateId)} ${name}v${dash(v.version)}  ${scope(v.orgId)}`,
    ...(v.upgradeAvailable ? [`  有新版本 ${dash(v.publishedVersion)} 可用（再次 install --version ${dash(v.publishedVersion)} 切换）`] : []),
    ...(v.dependencies?.items?.length ? ['', ...renderDependencyCheck(v.dependencies)] : []),
  ].join('\n');
}

export function renderInstalledList(result: unknown, pageNum: number, pageSize: number): string {
  const records = extractRecords<InstallationVo>(result);
  if (!records.length) return '还没有安装任何模板。';
  const rows = [['ID', '模板', '类型', '范围', '已装版本', '最新版本', '可升级', '安装时间']].concat(
    records.map((v) => [
      dash(v.id), `#${dash(v.templateId)} ${v.templateStatus === 'UNAVAILABLE' ? '（已不可见）' : dash(v.templateName)}`, dash(v.templateType),
      v.orgId ? `组织 #${v.orgId}` : '个人', dash(v.version), dash(v.publishedVersion), v.upgradeAvailable ? '是' : '否', fmtDateTime(v.installedAt),
    ])
  );
  return `${renderTable(rows, { 1: { truncate: 36 } })}\n${pageFooter(result, records, pageNum, pageSize)}`;
}
