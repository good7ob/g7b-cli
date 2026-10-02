/**
 * CLI-boundary validation for `org ai-employee` (prd-0092 FP-8 / FP-9, api-0092): key actions,
 * the profile PATCH body (only the fields given are sent) and the shared error map.
 */

import { ErrorCodeMap, InputError, checkMaxLength, parseId, requireOneOf, requireText } from '../../../utils/cliHelpers';

export const KEY_ACTIONS = ['issue', 'regenerate', 'disable', 'enable'] as const;
export type KeyAction = typeof KEY_ACTIONS[number];
export const MCP_ROLES = ['VIEWER', 'DEVELOPER', 'MANAGER'] as const;
export const MAX_NICKNAME = 50;
export const MAX_PRODUCTS = 100;

export const AI_EMPLOYEE_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数值不合法（角色 / 能力项未知、产品不属于该组织、昵称超长）',
  1002: '组织或 AI 员工不存在，或不属于你',
  1007: '当前状态不允许该操作（员工已停用 / Key 已吊销）',
  2000: '该 AI 员工无权执行此操作或你不是组织 owner/admin',
};

export interface ProfileFlags { nickname?: string; role?: string; tools?: string; products?: string }

export interface CapabilityScope { tools?: string[]; productIds?: number[] }

export interface ProfileBody { nickname?: string; mcpRole?: string; capabilityScope?: CapabilityScope }

/** `a,b` -> ['a','b'] trimmed and de-duplicated; an empty string means "clear" (`[]`). */
const csv = (raw: string) => Array.from(new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)));

export function buildProfileBody(o: ProfileFlags): ProfileBody {
  if (o.nickname === undefined && o.role === undefined && o.tools === undefined && o.products === undefined) {
    throw new InputError('至少指定一项: --nickname / --role / --tools / --products');
  }
  const body: ProfileBody = {};
  if (o.nickname !== undefined) body.nickname = requireText(o.nickname.trim(), MAX_NICKNAME, '--nickname');
  if (o.role !== undefined) body.mcpRole = requireOneOf(o.role.trim().toUpperCase(), MCP_ROLES, '--role');
  const scope: CapabilityScope = {};
  if (o.tools !== undefined) {
    scope.tools = csv(o.tools).map((t) => {
      if (!/^[a-z][a-z0-9_]{1,63}$/i.test(t)) throw new InputError(`--tools 的每一项必须是能力代码（如 task_read），收到: ${t}`);
      return checkMaxLength(t, 64, '--tools');
    });
  }
  if (o.products !== undefined) {
    scope.productIds = Array.from(new Set(csv(o.products).map((p) => parseId(p, '--products 的每一项'))));
    if (scope.productIds.length > MAX_PRODUCTS) throw new InputError(`--products 最多 ${MAX_PRODUCTS} 个`);
  }
  if (o.tools !== undefined || o.products !== undefined) body.capabilityScope = scope;
  return body;
}
