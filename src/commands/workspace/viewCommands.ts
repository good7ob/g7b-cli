import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, fail, parseId } from '../../utils/cliHelpers';
import { WORKSPACE_ERROR_CODES } from './input';
import { Overview, renderOverview } from './renderOverview';
import {
  MyOrgs, MyProducts, MyTaskGroup, MyTasksSummary, renderMyTasks, renderOrgs, renderProducts, renderTaskGroup,
} from './renderViews';
import { MAX_PAGE_SIZE, MAX_URGENT_LIMIT, PRODUCT_SCOPES, TASK_GROUPS, buildProductsParams, buildTasksParams } from './viewInput';

/**
 * `workspace overview / tasks / products / product follow|unfollow / orgs` — read-only views of
 * everything that is "mine", plus following a product. All under /workspace; business errors
 * come back as HTTP 200 + non-200 `code`, mapped by `fail`.
 */

const BASE = '/workspace';

export function registerViewCommands(workspace: Command): void {
  workspace
    .command('overview')
    .description('One-screen overview: queue counters, my task groups, my busiest products, recent activity')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const overview: Overview = await apiClient.get(`${BASE}/overview`);
        emit(o.json, overview, () => renderOverview(overview ?? {}));
      } catch (error) {
        fail('获取工作台总览失败', error, WORKSPACE_ERROR_CODES);
      }
    });

  workspace
    .command('tasks')
    .description('My tasks: a summary plus the most urgent ones, or one page of a group with --group')
    .option('--group <group>', `Group (${TASK_GROUPS.join('|')}); omit for the summary view`)
    .option('-p, --page <num>', 'Page number (with --group; default 1)')
    .option('--page-size <num>', `Items per page (with --group; 1-${MAX_PAGE_SIZE}, default 20)`)
    .option('-l, --limit <num>', `Most urgent tasks to list without --group (1-${MAX_URGENT_LIMIT}, default 5)`)
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const params = buildTasksParams(o);
        const result = await apiClient.get(`${BASE}/my-tasks`, params);
        emit(o.json, result, () =>
          o.group ? renderTaskGroup((result ?? {}) as MyTaskGroup) : renderMyTasks((result ?? {}) as MyTasksSummary));
      } catch (error) {
        fail('获取我的任务失败', error, WORKSPACE_ERROR_CODES);
      }
    });

  workspace
    .command('products')
    .description('My products as cards: my open tasks, blocked / AI-working counts, progress and risk')
    .option('--scope <scope>', `Scope (${PRODUCT_SCOPES.join('|')}; default all)`)
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const result: MyProducts = await apiClient.get(`${BASE}/my-products`, buildProductsParams(o));
        emit(o.json, result, () => renderProducts(result ?? {}));
      } catch (error) {
        fail('获取我的产品失败', error, WORKSPACE_ERROR_CODES);
      }
    });

  const product = workspace.command('product').description('Follow / unfollow a product (shows under --scope following)');
  const followCommand = (verb: 'follow' | 'unfollow', description: string, done: string) =>
    product
      .command(`${verb} <productId>`)
      .description(description)
      .option('--json', 'Output as JSON')
      .action(async (rawId, o) => {
        try {
          const productId = parseId(rawId, 'productId');
          const url = `${BASE}/my-products/${productId}/follow`;
          const result = verb === 'follow' ? await apiClient.post(url) : await apiClient.delete(url);
          emit(o.json, result ?? { productId, following: verb === 'follow' }, () => `✓ ${done}: 产品 #${productId}`);
        } catch (error) {
          fail(verb === 'follow' ? '关注产品失败' : '取消关注产品失败', error, {
            ...WORKSPACE_ERROR_CODES,
            1002: '产品不存在',
            2000: '无权限：只能关注自己所在组织（active 成员）的产品',
          });
        }
      });
  followCommand('follow', 'Follow a product (idempotent; organization members only)', '已关注');
  followCommand('unfollow', 'Stop following a product (idempotent; only affects me)', '已取消关注');

  workspace
    .command('orgs')
    .description('My organizations with my role and member / AI employee / product / active task counters')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const result: MyOrgs = await apiClient.get(`${BASE}/my-orgs`);
        emit(o.json, result, () => renderOrgs(result ?? {}));
      } catch (error) {
        fail('获取我的组织失败', error, WORKSPACE_ERROR_CODES);
      }
    });
}
