/**
 * CLI-boundary validation for `blog` commands.
 *
 * Targets com.remostudio.blog (`/ms-blog/blog/**`), backed by table
 * `blog_article`. This used to be com.remostudio.msblog on table `t_blog`;
 * there used to be a second, dead blog module also called com.remostudio.blog
 * squatting on the `blog_article` name with a table that was never created
 * by any migration — every write through it 500'd. Backend V173 deleted that
 * dead module and renamed `t_blog` onto the table name it was blocking; a
 * later rename moved com.remostudio.msblog onto the now-free package name,
 * so there's one blog module now, named consistently with its table.
 *
 * ms-blog reads the caller's identity straight off raw `userId` / `given_name`
 * request headers (com.remostudio.market.util.CurrentUser) — there is no JWT
 * derivation for this module, so the CLI must supply them explicitly.
 */

import {
  InputError,
  checkMaxLength,
  parseIntInRange,
  requireText,
} from '../../utils/cliHelpers';
import configService from '../../services/ConfigService';

/** Mirrors com.remostudio.blog.base.enums.BlogStatus. */
export const STATUSES = ['draft', 'review', 'published', 'modify', 'off_shelf', 'deleted'] as const;
export const CODE_TO_STATUS: Record<number, string> = {
  0: 'draft', 1: 'review', 2: 'published', 3: 'modify', 4: 'off_shelf', 5: 'deleted',
};

export const MAX_TITLE = 200;
export const MAX_REASON = 255;
export const MAX_PAGE_SIZE = 100;

/** userId header: `--user-id`, else GOOD7OB_USER_ID, else `good7ob config set user-id <id>`. */
export function resolveUserId(raw?: string): number {
  const value = raw ?? process.env.GOOD7OB_USER_ID ?? configService.get('userId');
  if (value === undefined || value === null || value === '') {
    throw new InputError('缺少用户身份（userId）。用 --user-id <id> 指定，或运行 good7ob config set user-id <id>。');
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new InputError(`--user-id 必须是正整数，收到: ${value}`);
  }
  return n;
}

/** given_name header: free text, URL-encoded on the wire (the backend URLDecodes it). */
export function resolveGivenName(raw?: string): string {
  return raw && raw.trim() ? raw.trim() : 'good7ob-cli';
}

export function identityHeaders(userId: number, givenName: string): Record<string, string> {
  return { userId: String(userId), given_name: encodeURIComponent(givenName) };
}

export function buildMyListBody(o: {
  userId: number; status?: string; title?: string; page?: string; pageSize?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    userId: o.userId,
    currentPage: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
  };
  if (o.title) body.title = o.title;
  if (o.status !== undefined) {
    const idx = STATUSES.indexOf(o.status as (typeof STATUSES)[number]);
    if (idx < 0) throw new InputError(`--status 取值无效: ${o.status}（可选: ${STATUSES.join(' | ')}）`);
    body.status = idx;
  }
  return body;
}

/** Body shared by `draft` and `save` (BlogDTO: uid?, title, content, tagUid?). `uid` present = update. */
export function buildBlogDtoBody(o: { title?: string; content?: string; tag?: string }, uid?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: requireText(o.title, MAX_TITLE, '--title'),
    content: requireText(o.content, 1_000_000, '--content'),
  };
  if (uid) body.uid = uid;
  if (o.tag) body.tagUid = o.tag;
  return body;
}

export function buildReasonBody(uid: string, reason: string): Record<string, unknown> {
  return { uid, reason: checkMaxLength(reason, MAX_REASON, '--reason') };
}
