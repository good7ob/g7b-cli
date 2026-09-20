/**
 * CLI-boundary validation for the Template Center part 2 commands (install / use / instances / deps / package use /
 * upgrade). Field names and limits mirror InstallDto, InstantiateDto, PackageInstantiateDto and UpgradePreviewDto
 * (com.remostudio.template); everything is checked here before the first request.
 */

import { ErrorCodeMap, InputError, parseDate, parseId } from '../../utils/cliHelpers';
import { TEMPLATE_ERROR_CODES, TEMPLATE_TYPES, pageParams, upperOneOf } from './input';
import { ItemOverride, VarFlags, parseItemOverrides, resolveVariables } from './varsInput';
import { requireSemver } from './versionInput';

type Body = Record<string, unknown>;

/** T2 refines what the shared template codes mean when installing / instantiating (api-0091 §20). */
export const USE_ERROR_CODES: ErrorCodeMap = {
  ...TEMPLATE_ERROR_CODES,
  1000: '缺少必填参数（--org / --product 必填；TASK 类型必须带 --module）',
  1001: '参数值不合法：变量缺失 / 未知 / 类型不符；目标模块或用例目录不属于该产品；渲染结果不合法或超过 2 MB；超出数量上限',
  1002: '模板 / 版本 / 包 / 实例不存在或对你不可见；或产品不存在 / 不属于该组织',
  1006: '已存在（如 RELEASE 渲染出的版本号在该产品下已有）',
  1007: '当前状态不允许：模板未发布 / 已下架 / 已归档；缺必需依赖（可加 --with-deps）；包条目不满足版本约束；该类型暂无实例化处理器',
  2000: '你不是目标组织的活跃成员',
};

/** Instantiation is transactional but NOT idempotent: after a timeout the server may already have created everything. */
export const TIMEOUT_HINT = '服务端可能已执行，请先用 template instances 核对，勿盲目重试';

/** Creating up to 200 tasks in one transaction can outlast the 30 s default. */
export const INSTANTIATE_REQUEST = { timeout: 120_000 } as const;

export interface TargetFlags {
  org?: string; product?: string; module?: string; suite?: string; start?: string; end?: string; withDeps?: boolean;
}

/** Which of the per-type target options a template type actually uses (the server ignores the rest). */
export const TARGET_USE: Record<string, { module?: 'required' | 'optional'; suite?: true; dates?: true }> = {
  TASK: { module: 'required' },
  PRD: { module: 'optional' },
  TEST: { suite: true },
  RELEASE: { dates: true },
};

function optionalId(raw: string | undefined, label: string): number | undefined {
  return raw === undefined ? undefined : parseId(raw, label);
}

function dateRange(start: string | undefined, end: string | undefined): { plannedStartDate?: string; plannedEndDate?: string } {
  const plannedStartDate = start === undefined ? undefined : parseDate(start, '--start');
  const plannedEndDate = end === undefined ? undefined : parseDate(end, '--end');
  if (plannedStartDate && plannedEndDate && plannedEndDate < plannedStartDate) {
    throw new InputError(`--end (${plannedEndDate}) 不能早于 --start (${plannedStartDate})`);
  }
  return { plannedStartDate, plannedEndDate };
}

/** orgId / productId are mandatory; module / suite / dates / installDependencies only when given. */
export function buildTarget(o: TargetFlags): Body {
  return withoutUndefined({
    orgId: parseId(o.org, '--org'),
    productId: parseId(o.product, '--product'),
    moduleId: optionalId(o.module, '--module'),
    suiteId: optionalId(o.suite, '--suite'),
    ...dateRange(o.start, o.end),
    installDependencies: o.withDeps ? true : undefined,
  });
}

export const withoutUndefined = (body: Body): Body =>
  Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));

export interface UseFlags extends TargetFlags, VarFlags {
  version?: string;
}

export function buildInstantiateBody(o: UseFlags): Body {
  return withoutUndefined({
    ...buildTarget(o),
    version: o.version === undefined ? undefined : requireSemver(o.version, '--version'),
    variables: resolveVariables(o),
  });
}

export interface PackageUseFlags extends TargetFlags, VarFlags {
  item?: string[];
}

export function buildPackageUseBody(o: PackageUseFlags): Body {
  const overrides: ItemOverride[] = o.item?.length ? parseItemOverrides(o.item) : [];
  return withoutUndefined({
    ...buildTarget(o),
    variables: resolveVariables(o),
    items: overrides.length ? overrides : undefined,
  });
}

export function buildInstallBody(o: { org?: string; version?: string; withDeps?: boolean }): Body {
  return withoutUndefined({
    orgId: optionalId(o.org, '--org'),
    version: o.version === undefined ? undefined : requireSemver(o.version, '--version'),
    installDependencies: o.withDeps ? true : undefined,
  });
}

/** `template installed` / `template deps` query. */
export function buildInstalledParams(o: { org?: string; page?: string; pageSize?: string }): Record<string, number> {
  return withoutUndefined({ ...pageParams(o), orgId: optionalId(o.org, '--org') }) as Record<string, number>;
}

export function buildDepsParams(o: { org?: string; version?: string }): Record<string, string | number> {
  return withoutUndefined({
    orgId: optionalId(o.org, '--org'),
    version: o.version === undefined ? undefined : requireSemver(o.version, '--version'),
  }) as Record<string, string | number>;
}

export interface InstanceListFlags {
  template?: string; type?: string; org?: string; product?: string; package?: string; page?: string; pageSize?: string;
}

export function buildInstanceListParams(o: InstanceListFlags): Record<string, string | number> {
  return withoutUndefined({
    ...pageParams(o),
    templateId: optionalId(o.template, '--template'),
    type: o.type === undefined ? undefined : upperOneOf(o.type, TEMPLATE_TYPES, '--type'),
    orgId: optionalId(o.org, '--org'),
    productId: optionalId(o.product, '--product'),
    packageId: optionalId(o.package, '--package'),
  }) as Record<string, string | number>;
}

export function buildPreviewBody(o: VarFlags & { version?: string }): Body {
  return withoutUndefined({
    version: o.version === undefined ? undefined : requireSemver(o.version, '--version'),
    variables: resolveVariables(o),
  });
}
