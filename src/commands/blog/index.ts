import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, fail } from '../../utils/cliHelpers';
import {
  STATUSES, buildBlogDtoBody, buildMyListBody, buildReasonBody, identityHeaders, resolveGivenName, resolveUserId,
} from './input';
import { Blog, renderBlogDetail, renderBlogList } from './render';

/**
 * Blog commands (/ms-blog/blog/**) — backed by com.remostudio.blog (table
 * blog_article, formerly com.remostudio.msblog on table t_blog). The only
 * blog module left — a dead parallel module of the same final package name
 * was deleted in backend V173. See input.ts for background.
 *
 * Every write endpoint requires `--user-id` (or GOOD7OB_USER_ID /
 * `good7ob config set user-id <id>`) since the backend reads identity
 * straight off request headers, not the bearer token.
 */

const BASE = '/ms-blog/blog';
const oneOf = (values: readonly string[]) => values.join('|');

function withIdentity(cmd: Command): Command {
  return cmd
    .option('--user-id <id>', 'Your userId (defaults to GOOD7OB_USER_ID / config user-id)')
    .option('--given-name <name>', 'Display name sent to the backend (defaults to "good7ob-cli")');
}

export function registerBlogCommands(program: Command) {
  const blog = program
    .command('blog')
    .description('Blog — list your posts, read, draft, submit for review, withdraw/take down');

  withIdentity(blog.command('list'))
    .description('List your own blog posts')
    .option('--title <text>', 'Filter by title (substring)')
    .option('--status <status>', `Filter by status (${oneOf(STATUSES)})`)
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-100)', '20')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const userId = resolveUserId(o.userId);
        const body = buildMyListBody({ ...o, userId });
        const headers = identityHeaders(userId, resolveGivenName(o.givenName));
        const result = await apiClient.post(`${BASE}/getMyList`, body, { headers });
        emit(o.json, result, () => renderBlogList(result, Number(body.currentPage), Number(body.pageSize)));
      } catch (error) {
        fail('获取博客列表失败', error);
      }
    });

  blog
    .command('get <uid>')
    .description('Show a published post (public, no identity needed)')
    .option('--json', 'Output as JSON')
    .action(async (uid, o) => {
      try {
        const blog: Blog = await apiClient.get(`${BASE}/getBlogByUid`, { uid });
        emit(o.json, blog, () => renderBlogDetail(blog));
      } catch (error) {
        fail('获取博客详情失败', error);
      }
    });

  withIdentity(blog.command('get-mine <uid>'))
    .description('Show one of your own posts (any status, owner-only)')
    .option('--json', 'Output as JSON')
    .action(async (uid, o) => {
      try {
        const userId = resolveUserId(o.userId);
        const headers = identityHeaders(userId, resolveGivenName(o.givenName));
        const blog: Blog = await apiClient.get(`${BASE}/getMyBlog/${encodeURIComponent(uid)}`, undefined, { headers });
        emit(o.json, blog, () => renderBlogDetail(blog));
      } catch (error) {
        fail('获取博客详情失败', error);
      }
    });

  withIdentity(blog.command('draft [uid]'))
    .description('Create (omit uid) or update a draft (keeps status=draft)')
    .requiredOption('--title <title>', 'Title')
    .requiredOption('--content <text>', 'Body')
    .option('--tag <tagUid>', 'Tag uid')
    .option('--json', 'Output as JSON')
    .action(async (uid, o) => {
      try {
        const userId = resolveUserId(o.userId);
        const headers = identityHeaders(userId, resolveGivenName(o.givenName));
        await apiClient.post(`${BASE}/draft`, buildBlogDtoBody(o, uid), { headers });
        emit(o.json, { uid }, () => `✓ 草稿已保存${uid ? ` (${uid})` : ''}（创建接口不回显 uid，用 good7ob blog list --title "${o.title}" 查找）`);
      } catch (error) {
        fail('保存草稿失败', error);
      }
    });

  withIdentity(blog.command('save [uid]'))
    .description('Create (omit uid) or update a post and submit it for review (status=review)')
    .requiredOption('--title <title>', 'Title')
    .requiredOption('--content <text>', 'Body')
    .option('--tag <tagUid>', 'Tag uid')
    .option('--json', 'Output as JSON')
    .action(async (uid, o) => {
      try {
        const userId = resolveUserId(o.userId);
        const headers = identityHeaders(userId, resolveGivenName(o.givenName));
        await apiClient.post(`${BASE}/save`, buildBlogDtoBody(o, uid), { headers });
        emit(o.json, { uid }, () => `✓ 已提交审核${uid ? ` (${uid})` : ''}（创建接口不回显 uid，用 good7ob blog list --title "${o.title}" 查找）`);
      } catch (error) {
        fail('提交博客失败', error);
      }
    });

  withIdentity(blog.command('delete <uid>'))
    .description('Delete a post (draft/modify/off_shelf only)')
    .action(async (uid, o) => {
      try {
        const userId = resolveUserId(o.userId);
        const headers = identityHeaders(userId, resolveGivenName(o.givenName));
        await apiClient.post(`${BASE}/delete/${encodeURIComponent(uid)}`, undefined, { headers });
        console.log(`✓ 博客已删除: ${uid}`);
      } catch (error) {
        fail('删除博客失败', error);
      }
    });

  withIdentity(blog.command('revoke <uid>'))
    .description('Withdraw a post from review')
    .requiredOption('--reason <text>', 'Reason')
    .action(async (uid, o) => {
      try {
        const userId = resolveUserId(o.userId);
        const headers = identityHeaders(userId, resolveGivenName(o.givenName));
        await apiClient.post(`${BASE}/revoke`, buildReasonBody(uid, o.reason), { headers });
        console.log(`✓ 已撤销审核: ${uid}`);
      } catch (error) {
        fail('撤销审核失败', error);
      }
    });

  withIdentity(blog.command('down <uid>'))
    .description('Take a published post down')
    .requiredOption('--reason <text>', 'Reason')
    .action(async (uid, o) => {
      try {
        const userId = resolveUserId(o.userId);
        const headers = identityHeaders(userId, resolveGivenName(o.givenName));
        await apiClient.post(`${BASE}/down`, buildReasonBody(uid, o.reason), { headers });
        console.log(`✓ 已下架: ${uid}`);
      } catch (error) {
        fail('下架失败', error);
      }
    });
}
