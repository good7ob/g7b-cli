import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, guarded, parseId } from '../../utils/cliHelpers';
import { checkOutTarget, emitWithOut } from './outFile';
import { renderDependencyCheck, DependencyCheckVo } from './renderCheck';
import {
  InstallationVo, InstanceVo, renderInstalled, renderInstalledList, renderInstance, renderInstanceList,
} from './renderUse';
import {
  USE_ERROR_CODES as CODES, buildDepsParams, buildInstallBody, buildInstalledParams, buildInstanceListParams,
} from './useInput';
import { TEMPLATE_TYPES, oneOf } from './input';
import { withOutFlags } from './useFlags';

const BASE = '/templates';

const withPaging = (cmd: Command): Command => cmd
  .option('-p, --page <num>', 'Page number', '1')
  .option('--page-size <num>', 'Items per page (1-50)', '20');

/** install / uninstall / installed / deps / instances / instance: what I use, and what I created from it. */
export function registerInstallCommands(tpl: Command): void {
  tpl
    .command('install <id>')
    .description('Install a template into your personal scope or an organization (idempotent; counts as "used" so you can review it)')
    .option('--org <orgId>', 'Install for this organization (you must be an active member); default personal scope')
    .option('--version <x.y.z>', 'Version to install (must have been published; default the current published one)')
    .option('--with-deps', 'Also install missing / outdated installable dependencies (same scope, same transaction)')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('安装模板失败', CODES, async () => {
      const tid = parseId(id, 'id');
      const installed: InstallationVo = await apiClient.post(`${BASE}/${tid}/install`, buildInstallBody(o));
      emit(o.json, installed, () => renderInstalled(installed ?? {}));
    }));

  tpl
    .command('uninstall <id>')
    .description('Uninstall a template from a scope (soft delete; existing instances are kept; idempotent)')
    .option('--org <orgId>', 'Organization scope; default personal scope')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('卸载模板失败', CODES, async () => {
      const tid = parseId(id, 'id');
      const orgId = o.org === undefined ? undefined : parseId(o.org, '--org');
      const result = await apiClient.delete(`${BASE}/${tid}/install${orgId ? `?orgId=${orgId}` : ''}`);
      const scope = orgId ? `组织 #${orgId}` : '个人范围';
      emit(o.json, result, () => (result?.removed === false
        ? `模板 #${tid} 在${scope}本来就没有安装（未变化）`
        : `✓ 已卸载模板 #${tid}（${scope}）；已有实例保留`));
    }));

  withPaging(tpl.command('installed'))
    .description('Templates I installed (personal scope + my organizations), newest first')
    .option('--org <orgId>', 'Only this organization\'s installs (you must be a member)')
    .option('--json', 'Output as JSON')
    .action((o) => guarded('获取已安装模板失败', CODES, async () => {
      const params = buildInstalledParams(o);
      const result = await apiClient.get(`${BASE}/installed`, params);
      emit(o.json, result, () => renderInstalledList(result, params.pageNum, params.pageSize));
    }));

  tpl
    .command('deps <id>')
    .description('Dependency check (read-only): which required / optional dependencies are missing, outdated or unavailable')
    .option('--org <orgId>', 'Also count this organization\'s installs (you must be a member)')
    .option('--version <x.y.z>', 'Check this version (default the published one)')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('依赖检查失败', CODES, async () => {
      const tid = parseId(id, 'id');
      const check: DependencyCheckVo = await apiClient.get(`${BASE}/${tid}/dependencies/check`, buildDepsParams(o));
      emit(o.json, check, () => renderDependencyCheck(check ?? {}).join('\n'));
    }));

  withPaging(tpl.command('instances'))
    .description('Instances I created from templates, newest first (without the rendered content)')
    .option('--template <id>', 'Only this template')
    .option('--type <type>', `Only this template type (${oneOf(TEMPLATE_TYPES)})`)
    .option('--org <orgId>', 'Only this organization')
    .option('--product <productId>', 'Only this product')
    .option('--package <packageId>', 'Only instances created through this package')
    .option('--json', 'Output as JSON')
    .action((o) => guarded('获取实例列表失败', CODES, async () => {
      const params = buildInstanceListParams(o);
      const result = await apiClient.get(`${BASE}/instances`, params);
      emit(o.json, result, () => renderInstanceList(result, Number(params.pageNum), Number(params.pageSize)));
    }));

  withOutFlags(tpl.command('instance <id>'), 'the rendered result (document body, or the rendered JSON)')
    .description('Show one instance of mine: variables, created objects and the rendered result (documents in full)')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('获取实例失败', CODES, async () => {
      const iid = parseId(id, 'id');
      const out = checkOutTarget(o);
      const instance: InstanceVo = await apiClient.get(`${BASE}/instances/${iid}`);
      emitWithOut(o.json, instance, (writtenTo) => renderInstance(instance ?? {}, writtenTo), {
        file: out, force: o.force, content: instance?.renderedContent, failPrefix: `实例 #${iid} 已读取，但写入文件失败`,
      });
    }));
}
