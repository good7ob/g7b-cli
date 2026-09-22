/**
 * CLI-boundary validation for `pm activity` (prd-0092 FP-6, api-0092): exactly one of
 * --project / --task; `--since` switches from page mode (pageNum/pageSize) to cursor mode
 * (sinceId/limit); `--type` / `--actor` filters exist only on the project endpoint.
 */

import {
  ErrorCodeMap,
  InputError,
  checkMaxLength,
  normalizeTypeCode,
  parseId,
  parseIntInRange,
  requireOneOf,
  requireText,
} from '../../../utils/cliHelpers';

export const ACTOR_TYPES = ['USER', 'AGENT', 'SYSTEM'] as const;
export const POST_TYPES = ['NOTE', 'REPORT_UPLOADED'] as const;
export const MAX_PAGE_SIZE = 200;
export const MAX_LIMIT = 200;
export const MAX_SUMMARY = 500;

export const ACTIVITY_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数值不合法（动态类型 / actorType 未知、sinceId / limit 越界、summary 超长、url 不是 https）',
  1002: '任务 / 项目不存在，或不属于你所在的组织',
  2000: '无权限：该 AI 员工的能力范围不含 task_read / comment，或任务在其产品范围之外',
};

export interface ListFlags {
  project?: string; task?: string; since?: string; type?: string; actor?: string;
  limit?: string; page?: string; pageSize?: string;
}

export interface ListTarget {
  url: string;
  params: Record<string, string | number>;
}

export function buildListTarget(o: ListFlags): ListTarget {
  if ((o.project === undefined) === (o.task === undefined)) {
    throw new InputError('--project <id> 与 --task <id> 必须且只能指定一个');
  }
  const url = o.project !== undefined
    ? `/progress/projects/${parseId(o.project, '--project')}/activities`
    : `/progress/tasks/${parseId(o.task, '--task')}/activities`;

  const params: Record<string, string | number> = {};
  if (o.since !== undefined) {
    if (o.page !== undefined || o.pageSize !== undefined) {
      throw new InputError('--since 为游标模式，不能与 --page / --page-size 同时使用（分页数量请用 --limit）');
    }
    params.sinceId = parseIntInRange(o.since, '--since', 0, Number.MAX_SAFE_INTEGER);
    params.limit = parseIntInRange(o.limit ?? '50', '--limit', 1, MAX_LIMIT);
  } else {
    if (o.limit !== undefined) {
      throw new InputError('--limit 只在 --since 游标模式下有效，分页模式请用 --page-size');
    }
    params.pageNum = parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000);
    params.pageSize = parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE);
  }

  if (o.task !== undefined && (o.type !== undefined || o.actor !== undefined)) {
    throw new InputError('--type / --actor 只支持 --project（任务动态不做类型 / 来源过滤）');
  }
  if (o.type !== undefined) {
    const types = o.type.split(',').map((t) => t.trim()).filter(Boolean);
    if (!types.length) throw new InputError('--type 不能为空（逗号分隔的动态类型，如 HANDOFF,NOTE）');
    params.types = Array.from(new Set(types.map((t) => normalizeTypeCode(t, '--type')))).join(',');
  }
  if (o.actor !== undefined) {
    params.actorType = requireOneOf(o.actor.trim().toUpperCase(), ACTOR_TYPES, '--actor');
  }
  return { url, params };
}

export interface PostFlags { task?: string; summary?: string; type?: string; url?: string }

export interface PostBody {
  type: string;
  summary: string;
  metadata?: { url: string };
}

export function buildPostBody(o: PostFlags): { taskId: number; body: PostBody } {
  const taskId = parseId(o.task, '--task');
  const summary = requireText(o.summary, MAX_SUMMARY, '--summary');
  const type = requireOneOf((o.type ?? 'NOTE').trim().toUpperCase(), POST_TYPES, '--type');
  const body: PostBody = { type, summary };
  if (o.url !== undefined) {
    const url = checkMaxLength(o.url.trim(), 2048, '--url');
    if (!/^https:\/\/\S+$/.test(url)) throw new InputError(`--url 必须是 https:// 开头的地址，收到: ${o.url}`);
    body.metadata = { url };
  }
  return { taskId, body };
}
