/**
 * `good7ob github` (prd-0124): manage registered repos and push my GitHub PRs to the platform.
 * Read-only toward GitHub (via the gh CLI); the only writes are the platform calls below.
 */
import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { ConfigService } from '../../services/ConfigService';
import { InputError, emit, guarded, parseDate, parseId, renderTable, requireOneOf, dash, fmtDateTime } from '../../utils/cliHelpers';
import { resolveOrgId } from '../../utils/resolveOrgId';
import { ghPrList, ghUser } from './gh';
import { batchesOf, collectPrs, mapPr, sinceFor } from './logic';

const KINDS = ['code', 'docs', 'infra', 'other'] as const;
const CODES = { 1001: '仓库未登记或已停用（整批被拒绝）', 1006: '该 GitHub 登录名已绑定到其他平台账号' };

interface Binding { id: number; repoFullName: string; kind: string; isEnabled: boolean; lastSyncedAt?: unknown }
interface BatchResult { created: number; updated: number; skipped: number; unknownAuthors?: string[] }
interface RepoResult { repo: string; since: string; fetched: number; created: number; updated: number; skipped: number; capped: boolean }

type OrgOpt = { orgId?: string; json?: boolean };
const org = (o: OrgOpt): number => {
  if (o.orgId !== undefined) parseId(o.orgId, '--org-id');
  return resolveOrgId(o.orgId, new ConfigService().get('orgId'));
};
const repoName = (raw: string): string => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(raw)) throw new InputError(`仓库名必须是 owner/name 格式，收到: ${raw}`);
  return raw;
};
const bindingsOf = async (orgId: number): Promise<Binding[]> => (await apiClient.get(`/api/v1/orgs/${orgId}/repo-bindings`)) ?? [];

export function registerGithubCommands(program: Command) {
  const github = program.command('github').description('GitHub PR sync and registered repositories (prd-0124)');
  const repos = github.command('repos').description('Manage repositories registered for PR sync');

  repos.command('list').description('List registered repositories')
    .option('--org-id <id>', 'Organization').option('--json', 'Output as JSON')
    .action((o: OrgOpt) => guarded('查询失败', CODES, async () => {
      const list = await bindingsOf(org(o));
      emit(o.json, list, () => list.length === 0 ? '尚未登记仓库（good7ob github repos add owner/name）'
        : renderTable([['ID', '仓库', '类型', '启用', '上次同步'], ...list.map((b) => [String(b.id), b.repoFullName, b.kind, b.isEnabled ? '是' : '否', dash(fmtDateTime(b.lastSyncedAt))])]));
    }));

  repos.command('add <repo>').description('Register owner/name')
    .option('--kind <kind>', `${KINDS.join('|')}`, 'code').option('--org-id <id>', 'Organization')
    .option('--product-id <id>', 'Product').option('--app-id <id>', 'Product app')
    .action((repo: string, o: OrgOpt & { kind: string; productId?: string; appId?: string }) => guarded('登记失败', CODES, async () => {
      const body = {
        repoFullName: repoName(repo), kind: requireOneOf(o.kind, KINDS, '--kind'),
        productId: o.productId ? parseId(o.productId, '--product-id') : null,
        productAppId: o.appId ? parseId(o.appId, '--app-id') : null,
      };
      await apiClient.post(`/api/v1/orgs/${org(o)}/repo-bindings`, body);
      console.log(`✓ 已登记 ${body.repoFullName}`);
    }));

  repos.command('set <id>').description('Change kind or enable/disable')
    .option('--kind <kind>', KINDS.join('|')).option('--enable', 'Enable').option('--disable', 'Disable').option('--org-id <id>', 'Organization')
    .action((id: string, o: OrgOpt & { kind?: string; enable?: boolean; disable?: boolean }) => guarded('更新失败', CODES, async () => {
      if (o.enable && o.disable) throw new InputError('--enable 与 --disable 不能同时使用');
      const body = { kind: o.kind ? requireOneOf(o.kind, KINDS, '--kind') : undefined, enabled: o.enable ? true : o.disable ? false : undefined };
      if (body.kind === undefined && body.enabled === undefined) throw new InputError('至少指定 --kind、--enable、--disable 之一');
      await apiClient.patch(`/api/v1/orgs/${org(o)}/repo-bindings/${parseId(id, 'id')}`, body);
      console.log('✓ 已更新');
    }));

  repos.command('remove <id>').description('Unregister a repository')
    .option('--org-id <id>', 'Organization')
    .action((id: string, o: OrgOpt) => guarded('删除失败', CODES, async () => {
      await apiClient.delete(`/api/v1/orgs/${org(o)}/repo-bindings/${parseId(id, 'id')}`);
      console.log('✓ 已删除');
    }));

  github.command('account').description('Show my bound GitHub logins').option('--json', 'Output as JSON')
    .action((o: OrgOpt) => guarded('查询失败', CODES, async () => {
      const list: { login?: string; uid?: number }[] = (await apiClient.get('/api/v1/intg/github/accounts')) ?? [];
      emit(o.json, list, () => list.length ? list.map((a) => `${a.login} (uid ${a.uid})`).join('\n') : '尚未绑定 GitHub 账号（运行 good7ob github sync 会自动绑定）');
    }));

  github.command('sync').description('Push my GitHub PRs of registered repos to the platform')
    .option('--since <date>', 'Start date YYYY-MM-DD').option('--repo <owner/name>', 'Only this repo')
    .option('--org-id <id>', 'Organization').option('--json', 'Output as JSON')
    .action((o: OrgOpt & { since?: string; repo?: string }) => guarded('同步失败', CODES, async () => {
      const orgId = org(o);
      const since = o.since ? parseDate(o.since, '--since') : undefined;
      const wanted = o.repo ? repoName(o.repo) : undefined;

      const me = ghUser();
      await apiClient.post('/api/v1/intg/github/accounts', { login: me.login, uid: me.id });

      const enabled = (await bindingsOf(orgId)).filter((b) => b.isEnabled === true && (!wanted || b.repoFullName === wanted));
      if (enabled.length === 0) {
        throw new InputError('没有可同步的已启用仓库。先登记：good7ob github repos add owner/name');
      }

      const results: RepoResult[] = [];
      const unknown = new Set<string>();
      for (const b of enabled) {
        const from = sinceFor(b.lastSyncedAt, since);
        const { rows, capped } = await collectPrs(b.repoFullName, from, (s) => ghPrList(b.repoFullName, s));
        if (capped) console.error(`! ${b.repoFullName}: 超过 20 页仍未取完，请用 --since 缩小范围`);
        const total: RepoResult = { repo: b.repoFullName, since: from, fetched: rows.length, created: 0, updated: 0, skipped: 0, capped };
        for (const items of batchesOf(rows.map((r) => mapPr(b.repoFullName, r)))) {
          const res: BatchResult = await apiClient.post(`/api/v1/orgs/${orgId}/github/pull-requests/batch`, { items });
          total.created += res.created; total.updated += res.updated; total.skipped += res.skipped;
          (res.unknownAuthors ?? []).forEach((l) => unknown.add(l));
        }
        results.push(total);
      }
      const unknownAuthors = [...unknown];
      emit(o.json, { orgId, login: me.login, repos: results, unknownAuthors }, () => [
        ...results.map((r) => `${r.repo}（自 ${r.since}，取到 ${r.fetched}）: 新增 ${r.created} / 更新 ${r.updated} / 跳过 ${r.skipped}`),
        ...(unknownAuthors.length ? ['', `未绑定的作者: ${unknownAuthors.join(', ')}`, '这些登录名还没有绑定平台账号，他们的 PR 不会计入个人报表'] : []),
      ].join('\n'));
    }));
}
