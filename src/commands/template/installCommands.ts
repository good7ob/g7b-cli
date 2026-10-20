import { Command, Option } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, guarded, parseId } from '../../utils/cliHelpers';
import { checkOutTarget, emitWithOut } from './outFile';
import {
  InstallationVo, InstanceVo, renderInstalled, renderInstalledList, renderInstance, renderInstanceList,
} from './renderUse';
import {
  USE_ERROR_CODES as CODES, buildInstallBody, buildInstalledParams, buildInstanceListParams,
} from './useInput';
import { TEMPLATE_TYPES, oneOf } from './input';
import { withOutFlags } from './useFlags';

const BASE = '/templates';

const withPaging = (cmd: Command): Command => cmd
  .option('-p, --page <num>', 'Page number', '1')
  .option('--page-size <num>', 'Items per page (1-50)', '20');

/** install (指定模版) / uninstall / installed / instances / instance: what I use, and what I created from it. */
export function registerInstallCommands(tpl: Command): void {
  tpl
    .command('install <id>')
    .description('Specify (指定模版; command name install kept) a template for your personal scope or an organization (idempotent; counts as "used" so you can review it)')
    .option('--org <orgId>', 'Specify for this organization (you must be an active member); default personal scope')
    .option('--version <x.y.z>', 'Version to specify (must have been published; default the current published one)')
    .addOption(new Option('--with-deps').hideHelp()) // deprecated no-op: dependencies were removed in 1.2.0
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('指定模板失败', CODES, async () => {
      const tid = parseId(id, 'id');
      const installed: InstallationVo = await apiClient.post(`${BASE}/${tid}/install`, buildInstallBody(o));
      emit(o.json, installed, () => renderInstalled(installed ?? {}));
    }));

  tpl
    .command('uninstall <id>')
    .description('Cancel the specification (取消指定; command name uninstall kept) of a template in a scope (soft delete; existing instances are kept; idempotent)')
    .option('--org <orgId>', 'Organization scope; default personal scope')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('取消指定模板失败', CODES, async () => {
      const tid = parseId(id, 'id');
      const orgId = o.org === undefined ? undefined : parseId(o.org, '--org');
      const result = await apiClient.delete(`${BASE}/${tid}/install${orgId ? `?orgId=${orgId}` : ''}`);
      const scope = orgId ? `组织 #${orgId}` : '个人范围';
      emit(o.json, result, () => (result?.removed === false
        ? `模板 #${tid} 在${scope}本来就没有指定（未变化）`
        : `✓ 已取消指定模板 #${tid}（${scope}）；已有实例保留`));
    }));

  withPaging(tpl.command('installed'))
    .description('Templates I specified (已指定) (personal scope + my organizations), newest first')
    .option('--org <orgId>', 'Only this organization\'s specified templates (you must be a member)')
    .option('--json', 'Output as JSON')
    .action((o) => guarded('获取已指定模板失败', CODES, async () => {
      const params = buildInstalledParams(o);
      const result = await apiClient.get(`${BASE}/installed`, params);
      emit(o.json, result, () => renderInstalledList(result, params.pageNum, params.pageSize));
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
