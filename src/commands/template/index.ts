import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { collect, emit, guarded, parseId } from '../../utils/cliHelpers';
import { registerAdminCommands } from './adminCommands';
import { registerInstallCommands } from './installCommands';
import {
  LICENSES, SORTS, STATUSES, TAG_KINDS, TEMPLATE_ERROR_CODES as CODES, TEMPLATE_TYPES, VISIBILITIES,
  buildCreateBody, buildListParams, buildSearchRequest, buildTagsParams, buildUpdateBody, oneOf, pageParams, upperOneOf,
} from './input';
import { registerPackageCommands } from './packageCommands';
import { TemplateCard, TemplateDetail, renderTemplateDetail, renderTemplateList } from './render';
import { renderCategories, renderTags } from './renderMisc';
import { registerReviewCommands } from './reviewCommands';
import { registerUpgradeCommands } from './upgradeCommands';
import { registerUseCommands } from './useCommands';
import { registerVersionCommands, withPayloadFlags } from './versionCommands';
import { requireSemver } from './versionInput';
import { renderVersion, VersionVo } from './renderVersion';

/**
 * Template Center commands (api-0091, backend `/templates`): browse the catalog, manage my / my org's templates
 * and their versions, publish, favorite, review, bundle templates into packages, and (platform admins only)
 * moderate submissions. Versions, dependencies and diff live in versionCommands.ts, reviews in reviewCommands.ts,
 * packages in packageCommands.ts, the admin group in adminCommands.ts, and (part 2) install / instances in
 * installCommands.ts, `use` in useCommands.ts, `package use` in packageUseCommand.ts and `upgrade` in upgradeCommands.ts.
 *
 * Business errors come back as HTTP 200 + non-200 `code`; ApiClient throws on those and `guarded` maps them.
 */

const BASE = '/templates';

function withPaging(cmd: Command): Command {
  return cmd
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-50)', '20');
}

/** Shared metadata flags of create / update. */
function withMeta(cmd: Command): Command {
  return cmd
    .option('--description <text>', 'Description (max 2000 chars)')
    .option('--category <id>', 'Category id (see `template categories`)')
    .option('--visibility <v>', `Visibility (${oneOf(VISIBILITIES)}; ORGANIZATION needs --org)`)
    .option('--tags <a,b>', 'Tags, comma separated (max 10, each 1-30 chars); on update they replace the existing tags')
    .option('--license <l>', `License (${oneOf(LICENSES)})`);
}

function registerBrowse(tpl: Command): void {
  withPaging(tpl.command('search'))
    .description('Search the catalog: published templates visible to you (filters combine with AND)')
    .option('-k, --keyword <text>', 'Match name / description / tag')
    .option('--type <type>', `Template type (${oneOf(TEMPLATE_TYPES)})`)
    .option('--category <id>', 'Category id (includes sub-categories)')
    .option('--tag <name>', 'Tag name, repeatable (all must match, max 10)', collect)
    .option('--industry <name>', 'Industry tag')
    .option('--tech-stack <name>', 'Tech-stack tag')
    .option('--language <name>', 'Language tag')
    .option('--platform <name>', 'Platform tag')
    .option('--pricing <p>', 'Pricing type (FREE|ONE_TIME|SUBSCRIPTION|PRIVATE; only FREE exists today)')
    .option('--min-rating <n>', 'Minimum average rating (0-5)')
    .option('--author <userId>', 'Only templates created by this user')
    .option('--official', 'Only official templates')
    .option('--no-official', 'Only non-official templates')
    .option('--sort <s>', `Sort (${oneOf(SORTS)}, default latest)`)
    .option('--json', 'Output as JSON')
    .action((o) => guarded('搜索模板失败', CODES, async () => {
      const { url, params } = buildSearchRequest(o);
      const result = await apiClient.get(url, params);
      emit(o.json, result, () => renderTemplateList(result, Number(params.pageNum), Number(params.pageSize)));
    }));

  tpl
    .command('get <id>')
    .description('Show a template with its published version (content + variables + dependencies); --version shows that version instead')
    .option('--version <x.y.z>', 'Show this version (like `template version get`)')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('获取模板失败', CODES, async () => {
      const tid = parseId(id, 'id');
      if (o.version !== undefined) {
        const version: VersionVo = await apiClient.get(`${BASE}/${tid}/versions/${requireSemver(o.version, '--version')}`);
        return emit(o.json, version, () => renderVersion(version));
      }
      const detail: TemplateDetail = await apiClient.get(`${BASE}/${tid}`);
      emit(o.json, detail, () => renderTemplateDetail(detail));
    }));

  withPaging(tpl.command('mine'))
    .description('Templates I created (any status)')
    .option('--status <s>', `Filter by status (${oneOf(STATUSES)})`)
    .option('--type <type>', `Filter by type (${oneOf(TEMPLATE_TYPES)})`)
    .option('--json', 'Output as JSON')
    .action((o) => guarded('获取我的模板失败', CODES, async () => {
      const params = buildListParams(o);
      const result = await apiClient.get(`${BASE}/mine`, params);
      emit(o.json, result, () => renderTemplateList(result, Number(params.pageNum), Number(params.pageSize), '你还没有创建模板。'));
    }));

  withPaging(tpl.command('org <orgId>'))
    .description('Templates of an organization (members see the library scope; owners/admins also see drafts)')
    .option('--status <s>', `Filter by status (${oneOf(STATUSES)})`)
    .option('--type <type>', `Filter by type (${oneOf(TEMPLATE_TYPES)})`)
    .option('--json', 'Output as JSON')
    .action((orgId, o) => guarded('获取组织模板失败', CODES, async () => {
      const params = buildListParams(o);
      const result = await apiClient.get(`${BASE}/org/${parseId(orgId, 'orgId')}`, params);
      emit(o.json, result, () => renderTemplateList(result, Number(params.pageNum), Number(params.pageSize), '该组织没有模板。'));
    }));

  withPaging(tpl.command('favorites'))
    .description('My favorites that are still in the library')
    .option('--json', 'Output as JSON')
    .action((o) => guarded('获取收藏失败', CODES, async () => {
      const params = pageParams(o);
      const result = await apiClient.get(`${BASE}/favorites`, params);
      emit(o.json, result, () => renderTemplateList(result, params.pageNum, params.pageSize, '还没有收藏。'));
    }));

  tpl
    .command('categories')
    .description('Category tree (one root per template type)')
    .option('--type <type>', `Only this template type (${oneOf(TEMPLATE_TYPES)})`)
    .option('--json', 'Output as JSON')
    .action((o) => guarded('获取分类失败', CODES, async () => {
      const params = o.type ? { type: upperOneOf(o.type, TEMPLATE_TYPES, '--type') } : undefined;
      const result = await apiClient.get(`${BASE}/categories`, params);
      emit(o.json, result, () => renderCategories(result));
    }));

  tpl
    .command('tags')
    .description('Popular tags on public published templates')
    .option('--kind <kind>', `Tag kind (${oneOf(TAG_KINDS)})`)
    .option('-k, --keyword <text>', 'Filter by keyword')
    .option('--limit <n>', 'Max tags (1-100, default 50)')
    .option('--json', 'Output as JSON')
    .action((o) => guarded('获取标签失败', CODES, async () => {
      const result = await apiClient.get(`${BASE}/tags`, buildTagsParams(o));
      emit(o.json, result, () => renderTags(result));
    }));
}

function registerManage(tpl: Command): void {
  withPayloadFlags(withMeta(tpl.command('create')))
    .description('Create a template (personal, or an organization template with --org); with --content also creates the first DRAFT version')
    .requiredOption('--name <name>', 'Name (max 100 chars, unique per owner)')
    .requiredOption('--type <type>', `Template type (${oneOf(TEMPLATE_TYPES)})`)
    .option('--org <orgId>', 'Create an organization template (you must be its owner/admin)')
    .option('--version <x.y.z>', 'First version number (default 1.0.0; needs --content)')
    .option('--json', 'Output as JSON')
    .action((o) => guarded('创建模板失败', CODES, async () => {
      const created: TemplateCard = await apiClient.post(BASE, buildCreateBody(o));
      emit(o.json, created, () => `✓ 模板已创建 (${created?.status ?? '-'}): #${created?.id ?? '-'} ${created?.name ?? o.name}`);
    }));

  withMeta(tpl.command('update <id>'))
    .description('Update template metadata (omitted flags stay unchanged; content lives in versions)')
    .option('--name <name>', 'Name (max 100 chars)')
    .option('--clear-tags', 'Remove all tags')
    .option('--resubmit-for-review', 'Needed to make a published, never-reviewed template PUBLIC: it goes back to DRAFT for platform review')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('更新模板失败', CODES, async () => {
      const updated = await apiClient.put(`${BASE}/${parseId(id, 'id')}`, buildUpdateBody(o));
      emit(o.json, updated, () => `✓ 模板已更新: #${id}`);
    }));

  tpl
    .command('delete <id>')
    .description('Delete a template (soft delete; only DRAFT / ARCHIVED with no instances)')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('删除模板失败', CODES, async () => {
      const tid = parseId(id, 'id');
      await apiClient.delete(`${BASE}/${tid}`);
      emit(o.json, { deleted: true, id: tid }, () => `✓ 模板已删除: #${tid}`);
    }));

  for (const [name, past] of [['archive', '已归档'], ['unarchive', '已恢复']] as const) {
    tpl
      .command(`${name} <id>`)
      .description(name === 'archive' ? 'Archive a template (DRAFT / REJECTED / PUBLISHED)' : 'Restore an archived template (PUBLISHED if it has a published version, else DRAFT)')
      .option('--json', 'Output as JSON')
      .action((id, o) => guarded(`${name === 'archive' ? '归档' : '恢复'}模板失败`, CODES, async () => {
        const result: TemplateCard = await apiClient.post(`${BASE}/${parseId(id, 'id')}/${name}`);
        emit(o.json, result, () => `✓ 模板 #${id} ${past}${result?.status ? ` → ${result.status}` : ''}`);
      }));
  }

  for (const [name, verb] of [['favorite', '收藏'], ['unfavorite', '取消收藏']] as const) {
    tpl
      .command(`${name} <id>`)
      .description(name === 'favorite' ? 'Favorite a template (idempotent; it must be in your library)' : 'Remove a template from favorites (idempotent)')
      .option('--json', 'Output as JSON')
      .action((id, o) => guarded(`${verb}失败`, CODES, async () => {
        const tid = parseId(id, 'id');
        const result = name === 'favorite'
          ? await apiClient.post(`${BASE}/${tid}/favorite`)
          : await apiClient.delete(`${BASE}/${tid}/favorite`);
        emit(o.json, result, () => `✓ 模板 #${tid} ${name === 'favorite' ? '已收藏' : '已取消收藏'}，当前收藏数: ${result?.favoriteCount ?? '—'}`);
      }));
  }
}

export function registerTemplateCommands(program: Command) {
  const tpl = program
    .command('template')
    .description('Template Center — browse, create, version, publish, review, bundle, install and instantiate templates');

  registerBrowse(tpl);
  registerManage(tpl);
  registerVersionCommands(tpl);
  registerReviewCommands(tpl);
  registerPackageCommands(tpl);
  registerInstallCommands(tpl);
  registerUseCommands(tpl);
  registerUpgradeCommands(tpl);
  registerAdminCommands(tpl);
}
