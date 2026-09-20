/**
 * CLI-boundary validation for the collaboration commands (comment / attachment / tag / relation /
 * merge / duplicates). Limits mirror IdeaCommentDto / IdeaAttachmentDto / IdeaTagService /
 * IdeaRelationDto / IdeaMergeDto; the attachment address check mirrors IdeaAttachmentStorageGuard.
 */

import {
  InputError,
  checkMaxLength,
  parseId,
  parseIntInRange,
  requireOneOf,
  requireText,
} from '../../utils/cliHelpers';
import { MAX_PAGE_SIZE, MAX_TAG_LENGTH } from './input';

export const RELATION_TYPES = ['related', 'duplicate_of', 'blocks'] as const;
export const MAX_TAGS = 10;
export const MAX_COMMENT = 2000;
export const MAX_FILE_NAME = 255;
export const MAX_FILE_URL = 1000;
export const MAX_CONTENT_TYPE = 100;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_DUPLICATES = 20;

type Body = Record<string, string | number>;

export function buildCommentBody(o: { text?: string; parent?: string }): Body {
  const body: Body = { content: requireText(o.text, MAX_COMMENT, '--text') };
  if (o.parent !== undefined) body.parentId = parseId(o.parent, '--parent');
  return body;
}

export function buildCommentListParams(o: { page?: string; pageSize?: string }): Record<string, number> {
  return {
    pageNum: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
  };
}

// bucket.s3.amazonaws.com | bucket.s3.<region>.amazonaws.com | bucket.s3-<region>.amazonaws.com
const S3_HOST = /^[a-z0-9][a-z0-9.-]*\.s3([.-][a-z0-9-]+)?\.amazonaws\.com$/i;
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/;

function isDotSegment(segment: string): boolean {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // an undecodable segment can't be a dot segment; the server still validates the rest
  }
  return decoded === '' || decoded === '.' || decoded === '..';
}

/**
 * The shape the backend accepts: https, an S3 host, a path under /public/, no query / fragment /
 * userinfo / path traversal. The bucket name itself is server config, so only the shape is checked.
 */
export function checkFileUrl(raw: string | undefined): string {
  const url = requireText(raw, MAX_FILE_URL, '--url').trim();
  const m = /^https:\/\/([^/?#@\s]+)(\/[^?#\s]*)$/i.exec(url);
  const bad = () => new InputError(
    `--url 必须是项目存储内 /public/ 下的文件地址（https://<bucket>.s3.<region>.amazonaws.com/public/...，不含查询串 / # / 用户信息），收到: ${url}`);
  if (!m || !S3_HOST.test(m[1]) || !m[2].startsWith('/public/') || m[2] === '/public/') throw bad();
  if (m[2].slice(1).split('/').some(isDotSegment)) throw bad();
  return url;
}

export function buildAttachmentBody(o: { name?: string; url?: string; contentType?: string; size?: string }): Body {
  const body: Body = {
    fileName: requireText(o.name, MAX_FILE_NAME, '--name'),
    fileUrl: checkFileUrl(o.url),
    sizeBytes: parseIntInRange(o.size ?? '', '--size', 0, MAX_FILE_BYTES),
  };
  if (o.contentType !== undefined) body.contentType = checkMaxLength(o.contentType, MAX_CONTENT_TYPE, '--content-type');
  return body;
}

/**
 * `a,b,c` -> trimmed, lower-cased, de-duplicated (what the server stores anyway). An empty
 * string clears the tags.
 */
export function buildTagsBody(raw: string | undefined): { tags: string[] } {
  if (raw === undefined) throw new InputError('--tags 不能缺省（逗号分隔；传空字符串 "" 表示清空）');
  if (!raw.trim()) return { tags: [] };
  const tags = Array.from(new Set(raw.split(',').map((t) => t.trim().toLowerCase())));
  tags.forEach((tag) => {
    if (!tag || tag.length > MAX_TAG_LENGTH || CONTROL_CHARS.test(tag)) {
      throw new InputError(`--tags 每项必须是 1~${MAX_TAG_LENGTH} 个字符且不含控制字符，收到: ${tag || '(空)'}`);
    }
  });
  if (tags.length > MAX_TAGS) throw new InputError(`--tags 去重后最多 ${MAX_TAGS} 个，当前 ${tags.length} 个`);
  return { tags };
}

export function buildRelationBody(ideaId: number, o: { to?: string; type?: string }): Body {
  const relatedIdeaId = parseId(o.to, '--to');
  if (relatedIdeaId === ideaId) throw new InputError('--to 不能是 Idea 自身（不允许自关联）');
  return { relatedIdeaId, relationType: requireOneOf(o.type ?? '', RELATION_TYPES, '--type') };
}

export function buildMergeBody(ideaId: number, into: string | undefined): { targetIdeaId: number } {
  const targetIdeaId = parseId(into, '--into');
  if (targetIdeaId === ideaId) throw new InputError('--into 不能是 Idea 自身');
  return { targetIdeaId };
}

export function buildDuplicatesParams(limit: string | undefined): Record<string, number> | undefined {
  return limit === undefined ? undefined : { limit: parseIntInRange(limit, '--limit', 1, MAX_DUPLICATES) };
}
