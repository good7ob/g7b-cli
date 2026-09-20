import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { collect, emit, guarded, parseId } from '../../utils/cliHelpers';
import { TEMPLATE_ERROR_CODES as CODES, VISIBILITIES, oneOf } from './input';
import {
  buildPackageCreateBody, buildPackageListRequest, buildPackageUpdateBody,
} from './packageInput';
import { registerPackageUse } from './packageUseCommand';
import { PackageVo, renderPackage, renderPackageList } from './renderMisc';

const BASE = '/templates/packages';
const ITEM_HELP = 'Template in the package: <templateId>[:<constraint>], repeatable (max 30); constraint = * | x.y.z | ^x.y.z | ~x.y.z | >=x.y.z';

function withPackageFields(cmd: Command): Command {
  return cmd
    .option('--description <text>', 'Description (max 2000 chars)')
    .option('--visibility <v>', `Visibility (${oneOf(VISIBILITIES)}; ORGANIZATION needs --org)`)
    .option('--item <templateId[:constraint]>', ITEM_HELP, collect)
    .option('--json', 'Output as JSON');
}

/** `template package create|get|update|delete|list|publish|archive` — bundles of templates (no content of their own, no review). */
export function registerPackageCommands(tpl: Command): void {
  const pkg = tpl.command('package').description('Template packages: a named bundle of templates');
  registerPackageUse(pkg);

  withPackageFields(pkg.command('create'))
    .description('Create a DRAFT package (personal, or an organization package with --org)')
    .requiredOption('--name <name>', 'Name (max 100 chars)')
    .option('--org <orgId>', 'Create an organization package (you must be its owner/admin)')
    .action((o) => guarded('创建模板包失败', CODES, async () => {
      const created: PackageVo = await apiClient.post(BASE, buildPackageCreateBody(o));
      emit(o.json, created, () => `✓ 模板包已创建 (${created?.status ?? 'DRAFT'}): #${created?.id ?? '-'} ${created?.name ?? o.name}`);
    }));

  pkg
    .command('get <id>')
    .description('Show a package with its items (item names are blank when you cannot see that template)')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('获取模板包失败', CODES, async () => {
      const detail: PackageVo = await apiClient.get(`${BASE}/${parseId(id, 'id')}`);
      emit(o.json, detail, () => renderPackage(detail));
    }));

  withPackageFields(pkg.command('update <id>'))
    .description('Update a package (omitted flags stay unchanged; --item replaces ALL items)')
    .option('--name <name>', 'Name (max 100 chars)')
    .option('--clear-items', 'Remove all items')
    .action((id, o) => guarded('更新模板包失败', CODES, async () => {
      const updated = await apiClient.put(`${BASE}/${parseId(id, 'id')}`, buildPackageUpdateBody(o));
      emit(o.json, updated, () => `✓ 模板包已更新: #${id}`);
    }));

  pkg
    .command('delete <id>')
    .description('Delete a package (soft delete; only DRAFT / ARCHIVED)')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('删除模板包失败', CODES, async () => {
      const pid = parseId(id, 'id');
      await apiClient.delete(`${BASE}/${pid}`);
      emit(o.json, { deleted: true, id: pid }, () => `✓ 模板包已删除: #${pid}`);
    }));

  pkg
    .command('list')
    .description('Package library (published, visible to you); --mine or --org <id> for your own / an organization\'s')
    .option('-k, --keyword <text>', 'Search the library by name')
    .option('--mine', 'Packages I created (any status)')
    .option('--org <orgId>', 'Packages of an organization')
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-50)', '20')
    .option('--json', 'Output as JSON')
    .action((o) => guarded('获取模板包列表失败', CODES, async () => {
      const { url, params } = buildPackageListRequest(o);
      const result = await apiClient.get(url, params);
      emit(o.json, result, () => renderPackageList(result, Number(params.pageNum), Number(params.pageSize)));
    }));

  for (const [name, verb, past] of [['publish', '发布', '已发布'], ['archive', '归档', '已归档']] as const) {
    pkg
      .command(`${name} <id>`)
      .description(name === 'publish' ? 'Publish a DRAFT package (every item must be PUBLISHED and at least as visible as the package)' : 'Archive a package')
      .option('--json', 'Output as JSON')
      .action((id, o) => guarded(`${verb}模板包失败`, CODES, async () => {
        const result: PackageVo = await apiClient.post(`${BASE}/${parseId(id, 'id')}/${name}`);
        emit(o.json, result, () => `✓ 模板包 #${id} ${past}${result?.status ? ` (${result.status})` : ''}`);
      }));
  }
}
