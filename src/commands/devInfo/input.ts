/**
 * CLI-boundary validation for `dev-info` commands (prd-0117). The backend validates again; this only rejects
 * obvious mistakes before a request, and keeps plaintext secrets out of any output.
 */

import {
  ErrorCodeMap,
  InputError,
  parseDate,
  parseId,
  requireOneOf,
} from '../../utils/cliHelpers';

export const OWNER_TYPES = ['task', 'project', 'product', 'org'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];
export const ITEM_TYPES = ['REPOSITORY', 'ENDPOINT', 'SERVER', 'DATABASE', 'DEPLOYMENT', 'TEST_ACCOUNT', 'OTHER'] as const;
export const ENVS = ['DEV', 'TEST', 'STAGING', 'PROD', 'NONE'] as const;
export const LEVELS = ['L1', 'L2', 'L3', 'L4'] as const;
export const CLEARANCE_LEVELS = ['L1', 'L2', 'L3'] as const;
export const SCOPE_TYPES = ['ORG', 'PRODUCT', 'PROJECT'] as const;
export const GRANTEE_TYPES = ['USER', 'AI_EMPLOYEE'] as const;

export const DEV_INFO_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数值不合法',
  1002: '对象或条目不存在，或你看不到它',
  2000: '无权操作：安全级别或访问许可不足（敏感值需要对应级别的访问许可）',
};

export interface Owner {
  type: OwnerType;
  id: number;
}

export interface OwnerOptions {
  task?: string;
  project?: string;
  product?: string;
  org?: string;
}

/** Exactly one of --task / --project / --product / --org. */
export function resolveOwner(o: OwnerOptions): Owner {
  const given = OWNER_TYPES.filter((t) => o[t] !== undefined);
  if (given.length !== 1) {
    throw new InputError('必须且只能指定 --task / --project / --product / --org 之一');
  }
  const type = given[0];
  return { type, id: parseId(o[type], `--${type}`) };
}

/** `key=value` -> [key, value]; the value may itself contain `=`. */
export function parsePair(raw: string, label: string): [string, string] {
  const at = raw.indexOf('=');
  if (at <= 0) {
    throw new InputError(`${label} 需要 key=value 形式，收到: ${raw}`);
  }
  return [raw.slice(0, at).trim(), raw.slice(at + 1)];
}

export function pairsToObject(pairs: string[] | undefined, label: string): Record<string, string> | undefined {
  if (!pairs || !pairs.length) return undefined;
  return Object.fromEntries(pairs.map((p) => parsePair(p, label)));
}

export interface SecretOptions {
  secret?: string[];
  secretRef?: string[];
  secretEnv?: string[];
}

/**
 * Sensitive inputs: `--secret k=value`, `--secret-ref k=reference` (a pointer into a vault, stored as text) and
 * `--secret-env k=ENV_NAME` (read from the environment, keeps the value out of shell history).
 */
export function buildSecrets(
  o: SecretOptions,
  env: NodeJS.ProcessEnv = process.env
): Record<string, { value?: string; ref?: string }> | undefined {
  const out: Record<string, { value?: string; ref?: string }> = {};
  const add = (key: string, input: { value?: string; ref?: string }) => {
    if (out[key]) throw new InputError(`敏感字段 ${key} 重复指定`);
    out[key] = input;
  };
  (o.secret ?? []).forEach((p) => {
    const [k, v] = parsePair(p, '--secret');
    add(k, { value: v });
  });
  (o.secretRef ?? []).forEach((p) => {
    const [k, v] = parsePair(p, '--secret-ref');
    add(k, { ref: v });
  });
  (o.secretEnv ?? []).forEach((p) => {
    const [k, name] = parsePair(p, '--secret-env');
    const value = env[name];
    if (value === undefined) throw new InputError(`环境变量 ${name} 未设置（--secret-env ${k}=${name}）`);
    add(k, { value });
  });
  return Object.keys(out).length ? out : undefined;
}

export interface ItemOptions extends SecretOptions {
  type?: string;
  env?: string;
  name?: string;
  description?: string;
  field?: string[];
  level?: string;
  appId?: string;
  cloudAppId?: string;
  expires?: string;
  clearExpires?: boolean;
  ackSecretWarning?: boolean;
}

/** Body for POST (create) / PUT (update); undefined keys are dropped so an update only sends what was given. */
export function buildItemBody(o: ItemOptions, create: boolean): Record<string, unknown> {
  if (o.expires !== undefined && o.clearExpires) {
    throw new InputError('--expires 与 --clear-expires 不能同时使用');
  }
  const body: Record<string, unknown> = {
    type: o.type === undefined ? undefined : requireOneOf(o.type.toUpperCase(), ITEM_TYPES, '--type'),
    env: o.env === undefined ? undefined : requireOneOf(o.env.toUpperCase(), ENVS, '--env'),
    name: o.name,
    description: o.description,
    fields: pairsToObject(o.field, '--field'),
    secrets: buildSecrets(o),
    securityLevel: o.level === undefined ? undefined : requireOneOf(o.level.toUpperCase(), LEVELS, '--level'),
    appId: o.appId === undefined ? undefined : parseId(o.appId, '--app-id'),
    cloudAppId: o.cloudAppId === undefined ? undefined : parseId(o.cloudAppId, '--cloud-app-id'),
    expiresAt: o.expires === undefined ? undefined : parseDate(o.expires, '--expires'),
    clearExpiresAt: o.clearExpires ? true : undefined,
    acknowledgeSecretWarning: o.ackSecretWarning ? true : undefined,
  };
  if (create && (!body.type || !o.name || !o.name.trim())) {
    throw new InputError('create 必须指定 --type 与 --name');
  }
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

export interface Grantee {
  type: (typeof GRANTEE_TYPES)[number];
  id: number;
}

/** `USER:12` or `AI_EMPLOYEE:3` (case-insensitive type). */
export function parseGrantee(raw: string, label: string): Grantee {
  const [type, id] = raw.split(':');
  if (id === undefined) {
    throw new InputError(`${label} 需要 USER:<id> 或 AI_EMPLOYEE:<id> 形式，收到: ${raw}`);
  }
  return { type: requireOneOf(type.toUpperCase(), GRANTEE_TYPES, label), id: parseId(id, label) };
}

export interface SecurityOptions {
  level?: string;
  reason?: string;
  l4Grantee?: string[];
  clearL4Grantees?: boolean;
}

export function buildSecurityBody(o: SecurityOptions): Record<string, unknown> {
  if (o.level === undefined) throw new InputError('--level 必填 (L1|L2|L3|L4)');
  if (o.clearL4Grantees && o.l4Grantee?.length) {
    throw new InputError('--l4-grantee 与 --clear-l4-grantees 不能同时使用');
  }
  const body: Record<string, unknown> = { securityLevel: requireOneOf(o.level.toUpperCase(), LEVELS, '--level') };
  if (o.reason !== undefined) body.reason = o.reason;
  if (o.l4Grantee?.length) body.l4Grantees = o.l4Grantee.map((g) => parseGrantee(g, '--l4-grantee'));
  if (o.clearL4Grantees) body.l4Grantees = [];
  return body;
}

export interface GrantOptions {
  org?: string;
  grantee?: string;
  level?: string;
  scope?: string;
  scopeId?: string;
}

export function buildGrantBody(o: GrantOptions): Record<string, unknown> {
  if (o.org === undefined || o.grantee === undefined || o.level === undefined || o.scope === undefined) {
    throw new InputError('grant 必须指定 --org --grantee --level --scope');
  }
  const scopeType = requireOneOf(o.scope.toUpperCase(), SCOPE_TYPES, '--scope');
  if (scopeType !== 'ORG' && o.scopeId === undefined) {
    throw new InputError(`--scope ${scopeType} 需要 --scope-id`);
  }
  const body: Record<string, unknown> = {
    orgId: parseId(o.org, '--org'),
    grantee: parseGrantee(o.grantee, '--grantee'),
    level: requireOneOf(o.level.toUpperCase(), CLEARANCE_LEVELS, '--level (许可级别 L1-L3)'),
    scopeType,
  };
  if (scopeType !== 'ORG') body.scopeId = parseId(o.scopeId, '--scope-id');
  return body;
}

export interface GetOptions extends OwnerOptions {
  type?: string;
  env?: string;
  includeExpired?: boolean;
  reveal?: string;
  item?: string;
}

/** Query for GET /dev-info/{type}/{id}/effective. */
export function buildEffectiveParams(o: GetOptions): Record<string, string | boolean> {
  const params: Record<string, string | boolean> = {};
  if (o.type !== undefined) params.type = requireOneOf(o.type.toUpperCase(), ITEM_TYPES, '--type');
  if (o.env !== undefined) params.env = requireOneOf(o.env.toUpperCase(), ENVS, '--env');
  if (o.includeExpired) params.includeExpired = true;
  return params;
}

/** `--reveal` is explicit: it needs the field and the entry; the task (when the owner is a task) is audited. */
export function buildRevealRequest(o: GetOptions): { itemId: number; body: { field: string; taskId?: number } } {
  if (o.reveal === undefined || !o.reveal.trim()) throw new InputError('--reveal 需要敏感字段名，如 --reveal password');
  if (o.item === undefined) throw new InputError('--reveal 需要用 --item <条目ID> 指明条目');
  const body: { field: string; taskId?: number } = { field: o.reveal.trim() };
  if (o.task !== undefined) body.taskId = parseId(o.task, '--task');
  return { itemId: parseId(o.item, '--item'), body };
}
