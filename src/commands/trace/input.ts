/**
 * CLI-boundary validation for `trace` commands. Mirrors TraceLinkService: type codes are
 * 2-32 chars of A-Z/0-9/_ (case-insensitive), linkType is one of four, source/target
 * type+id come as pairs, page size is 1..200.
 */

import {
  ErrorCodeMap,
  InputError,
  normalizeTypeCode,
  parseId,
  parseIntInRange,
  requireOneOf,
  resolveProductId,
} from '../../utils/cliHelpers';

export const LINK_TYPES = ['derived_from', 'impacts', 'implements', 'verifies'] as const;
export const MAX_PAGE_SIZE = 200;

export const TRACE_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数值不合法（类型代码格式 / linkType / source 与 target 相同 / type 与 id 未成对）',
  1002: '追溯关系 / 产品不存在（或已删除）',
  1006: '追溯关系已存在（同一产品下相同的 source、target、linkType）',
  2000: '无权访问：你不是该产品所属组织的成员',
};

interface Endpoint { type?: string; id?: string }

/** Both halves or neither: returns the normalised pair (or undefined when absent). */
function pair(e: Endpoint, name: 'source' | 'target'): { type: string; id: number } | undefined {
  if (e.type === undefined && e.id === undefined) return undefined;
  if (e.type === undefined || e.id === undefined) {
    throw new InputError(`--${name}-type 与 --${name}-id 必须同时提供`);
  }
  return { type: normalizeTypeCode(e.type, `--${name}-type`), id: parseId(e.id, `--${name}-id`) };
}

interface Flags {
  product?: string; sourceType?: string; sourceId?: string; targetType?: string; targetId?: string; linkType?: string;
}

export function buildCreateBody(o: Flags): Record<string, string | number> {
  const productId = resolveProductId(o.product);
  const source = pair({ type: o.sourceType, id: o.sourceId }, 'source');
  const target = pair({ type: o.targetType, id: o.targetId }, 'target');
  if (!source || !target) throw new InputError('--source-type/--source-id 与 --target-type/--target-id 均为必填');
  if (source.type === target.type && source.id === target.id) {
    throw new InputError('来源和目标不能是同一个对象');
  }
  const linkType = requireOneOf(o.linkType ?? '', LINK_TYPES, '--link-type');
  return {
    productId, sourceType: source.type, sourceId: source.id, targetType: target.type, targetId: target.id, linkType,
  };
}

export function buildListParams(o: Flags & { page?: string; pageSize?: string }): Record<string, string | number> {
  const params: Record<string, string | number> = {
    productId: resolveProductId(o.product),
    pageNum: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '50', '--page-size', 1, MAX_PAGE_SIZE),
  };
  const source = pair({ type: o.sourceType, id: o.sourceId }, 'source');
  const target = pair({ type: o.targetType, id: o.targetId }, 'target');
  if (source) Object.assign(params, { sourceType: source.type, sourceId: source.id });
  if (target) Object.assign(params, { targetType: target.type, targetId: target.id });
  if (o.linkType !== undefined) params.linkType = requireOneOf(o.linkType, LINK_TYPES, '--link-type');
  return params;
}
