import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, guarded, parseId } from '../../utils/cliHelpers';
import { STATUSES, TEMPLATE_ERROR_CODES as CODES, oneOf, pageParams, upperOneOf } from './input';
import { TemplateCard, TemplateDetail, renderTemplateDetail, renderTemplateList } from './render';
import { renderReviewQueue } from './renderMisc';
import { buildModerationBody } from './versionInput';

const BASE = '/admin/templates';

/**
 * The admin endpoints sit behind AdminAuthInterceptor: only a Bearer token whose userType is `admin` (a Cognito
 * admin-pool ID token, or a backend JWT for a sys_user) gets through. The CLI has no separate admin-credential
 * setting — it sends the one configured token, so an ordinary api-key / MCP key is refused with HTTP 403.
 */
export const ADMIN_HINT =
  '管理端接口只接受管理员身份的 Bearer token（Cognito 管理员池 ID token 或 userType=admin 的 JWT），普通 api-key / MCP key 会被拒绝；' +
  'CLI 没有单独的管理员凭证配置，可临时用环境变量 GOOD7OB_API_KEY=<管理员 token> 运行本命令';

/** Add the auth pointer to a "not an admin" rejection (HTTP 403 with no code, or business code 2000). */
export function withAdminHint(error: unknown): unknown {
  const message = error instanceof Error ? error.message : '';
  const code = (error as { code?: unknown } | null)?.code;
  if (code !== 2000 && !/admin privileges required|permission denied/i.test(message)) return error;
  const hinted: Error & { code?: unknown } = new Error(`${message ? `${message}；` : ''}${ADMIN_HINT}`);
  hinted.code = code;
  return hinted;
}

const adminGuarded = (prefix: string, fn: () => Promise<void>) =>
  guarded(prefix, CODES, () => fn().catch((error) => { throw withAdminHint(error); }));

/** `template admin ...`: platform-admin moderation of PUBLIC submissions (api-0091 §8). */
export function registerAdminCommands(tpl: Command): void {
  const admin = tpl.command('admin').description('Platform-admin review of public templates (needs an admin token, see GOOD7OB_API_KEY)');

  admin
    .command('reviews')
    .description('Review queue: versions waiting for approval, oldest submission first')
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-50)', '20')
    .option('--json', 'Output as JSON')
    .action((o) => adminGuarded('获取审核队列失败', async () => {
      const params = pageParams(o);
      const result = await apiClient.get(`${BASE}/reviews`, params);
      emit(o.json, result, () => renderReviewQueue(result, params.pageNum, params.pageSize));
    }));

  admin
    .command('list')
    .description('All templates (for suspending / restoring)')
    .option('--status <s>', `Filter by status (${oneOf(STATUSES)})`)
    .option('-k, --keyword <text>', 'Filter by name')
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-50)', '20')
    .option('--json', 'Output as JSON')
    .action((o) => adminGuarded('获取模板列表失败', async () => {
      const params: Record<string, string | number> = pageParams(o);
      if (o.status !== undefined) params.status = upperOneOf(o.status, STATUSES, '--status');
      if (o.keyword?.trim()) params.keyword = o.keyword.trim();
      const result = await apiClient.get(BASE, params);
      emit(o.json, result, () => renderTemplateList(result, Number(params.pageNum), Number(params.pageSize)));
    }));

  admin
    .command('show <versionId>')
    .description('Review detail: the template plus that version\'s content, variables and dependencies')
    .option('--json', 'Output as JSON')
    .action((versionId, o) => adminGuarded('获取审核详情失败', async () => {
      const detail: TemplateDetail = await apiClient.get(`${BASE}/versions/${parseId(versionId, 'versionId')}`);
      emit(o.json, detail, () => renderTemplateDetail(detail));
    }));

  admin
    .command('approve <versionId>')
    .description('Approve a REVIEWING version: it becomes the published version, the previous one is archived')
    .option('--comment <text>', 'Approval note (max 1000 chars)')
    .option('--json', 'Output as JSON')
    .action((versionId, o) => adminGuarded('批准失败', async () => {
      const vid = parseId(versionId, 'versionId');
      const body = buildModerationBody(o.comment, '--comment', false);
      const result: TemplateDetail = await apiClient.post(`${BASE}/versions/${vid}/approve`, body);
      emit(o.json, result, () => `✓ 版本 #${vid} 已批准并发布: 模板 #${result?.id ?? '-'} ${result?.name ?? ''} ${result?.publishedVersion ?? ''}`.trimEnd());
    }));

  admin
    .command('reject <versionId>')
    .description('Reject a REVIEWING version: it returns to DRAFT so the author can fix and resubmit')
    .requiredOption('--reason <text>', 'Rejection reason, shown to the author (max 1000 chars)')
    .option('--json', 'Output as JSON')
    .action((versionId, o) => adminGuarded('驳回失败', async () => {
      const vid = parseId(versionId, 'versionId');
      const body = buildModerationBody(o.reason, '--reason', true);
      const result: TemplateDetail = await apiClient.post(`${BASE}/versions/${vid}/reject`, body);
      emit(o.json, result, () => `✓ 版本 #${vid} 已驳回（退回 DRAFT）: 模板 #${result?.id ?? '-'} ${result?.name ?? ''}`.trimEnd());
    }));

  for (const [name, required, past] of [['suspend', true, '已下架'], ['unsuspend', false, '已恢复上架']] as const) {
    admin
      .command(`${name} <templateId>`)
      .description(name === 'suspend'
        ? 'Take a PUBLISHED template out of the library (no new instances; existing ones stay)'
        : 'Put a SUSPENDED template back into the library')
      .option('--reason <text>', required ? 'Reason (required, max 1000 chars)' : 'Note (max 1000 chars)')
      .option('--json', 'Output as JSON')
      .action((templateId, o) => adminGuarded(`${name === 'suspend' ? '下架' : '恢复上架'}失败`, async () => {
        const tid = parseId(templateId, 'templateId');
        const body = buildModerationBody(o.reason, '--reason', required);
        const result: TemplateCard = await apiClient.post(`${BASE}/${tid}/${name}`, body);
        emit(o.json, result, () => `✓ 模板 #${tid} ${past}${result?.status ? ` (${result.status})` : ''}`);
      }));
  }
}
