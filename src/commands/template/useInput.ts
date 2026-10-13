/**
 * CLI-boundary validation for the Template Center part 2 commands (install / use / instances / deps / package use /
 * upgrade). Field names and limits mirror InstallDto, InstantiateDto, PackageInstantiateDto and UpgradePreviewDto
 * (com.remostudio.template); everything is checked here before the first request.
 */

import { randomUUID } from 'crypto';
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

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{1,64}$/;

/** --idempotency-key flag (use / package use): same key = same result, the server never creates twice (g7b #1084). */
export const IDEMPOTENCY_OPTION = ['--idempotency-key <key>', 'Idempotency key (letters, digits, _ . : -, max 64); generated when omitted. Retry with the SAME key after a timeout: the server returns the first result instead of creating again'] as const;

/** The key to send: the one given with --idempotency-key, else a fresh UUID. */
export function resolveIdempotencyKey(flag: string | undefined): string {
  if (flag === undefined) return randomUUID();
  const key = flag.trim();
  if (!IDEMPOTENCY_KEY.test(key)) throw new InputError('--idempotency-key 只能含字母数字 _ . : -，最长 64 个字符');
  return key;
}

/** After a timeout the server may already have created everything; the same key makes the retry safe. */
export const timeoutHint = (key: string): string => `服务端可能已执行；用同一个幂等键重试不会重复创建：--idempotency-key ${key}`;

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
  itemOpt?: string[];
}

const ITEM_OPT_KEYS = ['module', 'suite', 'start', 'end'] as const;

/**
 * `--item-opt <templateId>:<module|suite|start|end>=<value>` (repeatable): per-item target override
 * (PackageInstantiateDto.Item moduleId / suiteId / plannedStartDate / plannedEndDate; wins over --module etc.).
 */
export function parseItemOpts(raw: string[]): Map<number, Body> {
  const byItem = new Map<number, Body>();
  for (const entry of raw) {
    const colon = entry.indexOf(':');
    const eq = entry.indexOf('=');
    if (colon <= 0 || eq < colon + 2) {
      throw new InputError(`--item-opt 必须是 <templateId>:<module|suite|start|end>=<值> 格式，收到: ${entry.slice(0, 80)}`);
    }
    const templateId = parseId(entry.slice(0, colon), '--item-opt 的 templateId');
    const key = entry.slice(colon + 1, eq);
    const value = entry.slice(eq + 1);
    if (!(ITEM_OPT_KEYS as readonly string[]).includes(key)) {
      throw new InputError(`--item-opt 的键必须是 ${ITEM_OPT_KEYS.join(' / ')}，收到: ${key}`);
    }
    const field = { module: 'moduleId', suite: 'suiteId', start: 'plannedStartDate', end: 'plannedEndDate' }[key] as string;
    const opts: Body = byItem.get(templateId) ?? {};
    if (field in opts) throw new InputError(`--item-opt ${templateId}:${key} 重复`);
    opts[field] = key === 'module' || key === 'suite' ? parseId(value, `--item-opt ${templateId}:${key}`) : parseDate(value, `--item-opt ${templateId}:${key}`);
    byItem.set(templateId, opts);
  }
  if (byItem.size > MAX_ITEMS_OPT) throw new InputError(`--item-opt 最多覆盖 ${MAX_ITEMS_OPT} 个模板，当前 ${byItem.size} 个`);
  byItem.forEach((opts, id) => {
    const start = opts.plannedStartDate as string | undefined;
    const end = opts.plannedEndDate as string | undefined;
    if (start && end && end < start) throw new InputError(`--item-opt ${id}: end (${end}) 不能早于 start (${start})`);
  });
  return byItem;
}

const MAX_ITEMS_OPT = 20;

/** Merge variable overrides (--item) and target overrides (--item-opt) into one entry per templateId. */
function mergeItems(vars: ItemOverride[], opts: Map<number, Body>): Body[] {
  const ids = Array.from(new Set([...vars.map((v) => v.templateId), ...Array.from(opts.keys())]));
  return ids.map((templateId) => ({
    templateId,
    ...withoutUndefined({ variables: vars.find((v) => v.templateId === templateId)?.variables }),
    ...opts.get(templateId),
  }));
}

export function buildPackageUseBody(o: PackageUseFlags): Body {
  const overrides: ItemOverride[] = o.item?.length ? parseItemOverrides(o.item) : [];
  const items = mergeItems(overrides, o.itemOpt?.length ? parseItemOpts(o.itemOpt) : new Map());
  return withoutUndefined({
    ...buildTarget(o),
    variables: resolveVariables(o),
    items: items.length ? items : undefined,
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
