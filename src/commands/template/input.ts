/**
 * CLI-boundary validation for `template` commands. Enums and limits mirror the backend
 * (com.remostudio.template: TemplateType, TemplateRules, TemplateTagService, TemplateSearchDto) so a bad
 * value is rejected here with a clear message instead of as a 1001 round-trip.
 */

import {
  ErrorCodeMap,
  InputError,
  checkMaxLength,
  parseId,
  parseIntInRange,
  requireOneOf,
  requireText,
} from '../../utils/cliHelpers';
import { PayloadFlags, loadPayload, requireSemver } from './versionInput';

export const TEMPLATE_TYPES = [
  'PRD', 'PROJECT', 'TASK', 'UI', 'API', 'DB', 'TEST', 'ARCH', 'AI_PROMPT', 'AGENT_SKILL', 'WORKFLOW', 'RELEASE',
] as const;
export const VISIBILITIES = ['PUBLIC', 'ORGANIZATION', 'PRIVATE'] as const;
export const STATUSES = ['DRAFT', 'REVIEWING', 'REJECTED', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED'] as const;
export const LICENSES = ['PERSONAL', 'ORGANIZATION', 'COMMERCIAL', 'ENTERPRISE'] as const;
export const PRICINGS = ['FREE', 'ONE_TIME', 'SUBSCRIPTION', 'PRIVATE'] as const;
export const SORTS = ['latest', 'popular', 'rating', 'installs'] as const;
export const TAG_KINDS = ['GENERAL', 'INDUSTRY', 'TECH_STACK', 'LANGUAGE', 'PLATFORM'] as const;

export const MAX_NAME = 100;
export const MAX_DESCRIPTION = 2000;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;
export const MAX_PAGE_SIZE = 50;

export const oneOf = (values: readonly string[]) => values.join('|');

export const TEMPLATE_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数值不合法（消息里带 JSON 路径时指内容 / 变量校验失败）',
  1002: '模板 / 版本 / 包 / 分类不存在，或对你不可见（私有模板不可见时同样返回不存在）',
  1003: '商业化未开放：目前只能创建免费模板（不支持非 FREE 定价、价格 > 0、订阅计划）',
  1006: '数据已存在：同名模板 / 版本号重复 / 依赖或包条目重复 / 已评价过',
  1007: '当前状态不允许该操作（归档 / 下架 / 审核中不可改；版本不是 DRAFT；已有版本在审核中；模板已有实例不可删除）',
  1009: '已被处理或并发冲突（例如版本已被别的管理员批准 / 驳回），请刷新后重试',
  2000: '无权限：可见但不可管理 / 非组织 owner 或 admin / 未安装使用就评价 / 评价自己的模板 / 非平台管理员',
};

/** Case-insensitive enum (the server upper-cases too); returns the canonical upper-case value. */
export function upperOneOf<T extends string>(raw: string, allowed: readonly T[], label: string): T {
  return requireOneOf(String(raw).trim().toUpperCase(), allowed, label);
}

export function pageParams(o: { page?: string; pageSize?: string }): { pageNum: number; pageSize: number } {
  return {
    pageNum: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
  };
}

/** `a,b,c` -> ['a','b','c']: trimmed, blanks dropped, case-insensitively de-duplicated, <=10 names of 1-30 chars. */
export function parseTags(raw: string, flag = '--tags'): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  raw.split(',').map((t) => t.trim()).filter(Boolean).forEach((tag) => {
    checkMaxLength(tag, MAX_TAG_LENGTH, `${flag} 的标签 "${tag.slice(0, 10)}…"`);
    if (!seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  });
  if (tags.length > MAX_TAGS) throw new InputError(`${flag} 最多 ${MAX_TAGS} 个标签，当前 ${tags.length} 个`);
  return tags;
}

function parseMinRating(raw: string): number {
  const text = String(raw).trim();
  const value = Number(text);
  if (!/^[0-9]+(\.[0-9]+)?$/.test(text) || value > 5) {
    throw new InputError(`--min-rating 必须在 0 到 5 之间，收到: ${raw}`);
  }
  return value;
}

export interface SearchFlags {
  keyword?: string; type?: string; category?: string; tag?: string[]; industry?: string; techStack?: string;
  language?: string; platform?: string; pricing?: string; minRating?: string; author?: string; official?: boolean;
  sort?: string; page?: string; pageSize?: string;
}

/**
 * GET /templates request. `tag` may repeat (all must match), and axios would serialise an array as `tag[]=…`
 * which Spring does not bind, so the tags go into the URL as plain repeated `tag=` pairs.
 */
export function buildSearchRequest(o: SearchFlags): { url: string; params: Record<string, string | number | boolean> } {
  const params: Record<string, string | number | boolean> = pageParams(o);
  if (o.keyword?.trim()) params.keyword = o.keyword.trim();
  if (o.type !== undefined) params.type = upperOneOf(o.type, TEMPLATE_TYPES, '--type');
  if (o.category !== undefined) params.categoryId = parseId(o.category, '--category');
  if (o.industry !== undefined) params.industry = requireText(o.industry, MAX_TAG_LENGTH, '--industry');
  if (o.techStack !== undefined) params.techStack = requireText(o.techStack, MAX_TAG_LENGTH, '--tech-stack');
  if (o.language !== undefined) params.language = requireText(o.language, MAX_TAG_LENGTH, '--language');
  if (o.platform !== undefined) params.platform = requireText(o.platform, MAX_TAG_LENGTH, '--platform');
  if (o.pricing !== undefined) params.pricingType = upperOneOf(o.pricing, PRICINGS, '--pricing');
  if (o.minRating !== undefined) params.minRating = parseMinRating(o.minRating);
  if (o.author !== undefined) params.authorId = parseId(o.author, '--author');
  if (o.official !== undefined) params.official = o.official;
  if (o.sort !== undefined) params.sort = requireOneOf(o.sort.trim().toLowerCase(), SORTS, '--sort');
  const tags = (o.tag ?? []).map((t) => requireText(t, MAX_TAG_LENGTH, '--tag'));
  if (tags.length > MAX_TAGS) throw new InputError(`--tag 最多 ${MAX_TAGS} 个，当前 ${tags.length} 个`);
  const query = tags.map((t) => `tag=${encodeURIComponent(t)}`).join('&');
  return { url: query ? `/templates?${query}` : '/templates', params };
}

/** `mine` / `org`: optional status + type filters and paging. */
export function buildListParams(o: { status?: string; type?: string; page?: string; pageSize?: string }): Record<string, string | number> {
  const params: Record<string, string | number> = pageParams(o);
  if (o.status !== undefined) params.status = upperOneOf(o.status, STATUSES, '--status');
  if (o.type !== undefined) params.type = upperOneOf(o.type, TEMPLATE_TYPES, '--type');
  return params;
}

export function buildTagsParams(o: { kind?: string; keyword?: string; limit?: string }): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (o.kind !== undefined) params.kind = upperOneOf(o.kind, TAG_KINDS, '--kind');
  if (o.keyword?.trim()) params.keyword = o.keyword.trim();
  if (o.limit !== undefined) params.limit = parseIntInRange(o.limit, '--limit', 1, 100);
  return params;
}

export interface MetaFlags {
  name?: string; description?: string; category?: string; visibility?: string; tags?: string; license?: string;
}

type Body = Record<string, unknown>;

function applyMeta(body: Body, o: MetaFlags): void {
  if (o.description !== undefined) body.description = checkMaxLength(o.description, MAX_DESCRIPTION, '--description');
  if (o.category !== undefined) body.categoryId = parseId(o.category, '--category');
  if (o.visibility !== undefined) body.visibility = upperOneOf(o.visibility, VISIBILITIES, '--visibility');
  if (o.tags !== undefined) body.tags = parseTags(o.tags);
  if (o.license !== undefined) body.licenseType = upperOneOf(o.license, LICENSES, '--license');
}

export interface FirstVersionFlags extends PayloadFlags {
  version?: string;
}

/** Content / variables for a first version: `version` and `variables` without `content` are rejected by the server (1001). */
function applyFirstVersion(body: Body, o: FirstVersionFlags): void {
  const payload = loadPayload(o);
  if (payload.content === undefined) {
    if (o.version !== undefined || o.changelog !== undefined || payload.variables !== undefined || payload.compatibility !== undefined) {
      throw new InputError('--version / --changelog / --variables-file / --compatibility-file 需要同时提供 --content-file 或 --content（否则不会创建版本）');
    }
    return;
  }
  Object.assign(body, payload);
  if (o.version !== undefined) body.version = requireSemver(o.version, '--version');
}

export function buildCreateBody(o: MetaFlags & FirstVersionFlags & { type?: string; org?: string }): Body {
  const body: Body = {
    name: requireText(o.name, MAX_NAME, '--name').trim(),
    templateType: upperOneOf(o.type ?? '', TEMPLATE_TYPES, '--type'),
  };
  applyMeta(body, o);
  if (o.org !== undefined) body.orgId = parseId(o.org, '--org');
  if (body.visibility === 'ORGANIZATION' && body.orgId === undefined) {
    throw new InputError('--visibility ORGANIZATION 只适用于组织模板：请同时指定 --org <orgId>');
  }
  applyFirstVersion(body, o);
  return body;
}

/** Omitted flag = field unchanged (backend contract), so only send what was given. */
export function buildUpdateBody(o: MetaFlags & { clearTags?: boolean; resubmitForReview?: boolean }): Body {
  const body: Body = {};
  if (o.name !== undefined) body.name = requireText(o.name, MAX_NAME, '--name').trim();
  applyMeta(body, o);
  if (o.tags !== undefined && o.clearTags) throw new InputError('--tags 与 --clear-tags 不能同时使用');
  if (o.clearTags) body.tags = [];
  if (o.resubmitForReview) body.resubmitForReview = true;
  if (Object.keys(body).length === 0) {
    throw new InputError('没有要修改的字段：至少指定 --name / --description / --category / --visibility / --tags / --clear-tags / --license / --resubmit-for-review 之一');
  }
  return body;
}
