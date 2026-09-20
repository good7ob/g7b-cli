import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { guarded, parseId, withTimeoutHint } from '../../utils/cliHelpers';
import { dryRunInstantiate } from './dryRun';
import { checkOutTarget, emitWithOut } from './outFile';
import { renderDryRun } from './renderDryRun';
import { InstanceVo, renderInstantiated } from './renderUse';
import { withOutFlags, withTargetFlags, withVarFlags } from './useFlags';
import { INSTANTIATE_REQUEST, TIMEOUT_HINT, USE_ERROR_CODES as CODES, buildInstantiateBody } from './useInput';
import { VarMap } from './varsInput';

const BASE = '/templates';

/**
 * `template use`: instantiate a template into real business objects (tasks, module, release, test cases, PRD
 * session, workflow template) or a rendered document, in ONE server transaction. `--dry-run` previews instead.
 */
export function registerUseCommands(tpl: Command): void {
  withOutFlags(withVarFlags(withTargetFlags(tpl.command('use <id>'))), 'the rendered document body (or rendered JSON)')
    .description('Instantiate a template into your product (one transaction; not idempotent — see `template instances` before retrying)')
    .option('--version <x.y.z>', 'Version to use (must have been published; default the current published one)')
    .option('--dry-run', 'Preview only: check dependencies and variables, render locally, create nothing')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('实例化模板失败', CODES, async () => {
      const tid = parseId(id, 'id');
      const body = buildInstantiateBody(o);
      const out = checkOutTarget(o);
      if (o.dryRun) {
        const report = await dryRunInstantiate(tid, o, body, body.variables as VarMap | undefined);
        return emitWithOut(o.json, report, (writtenTo) => renderDryRun(report, writtenTo), {
          file: out, force: o.force, content: report.renderedContent, failPrefix: '预演已完成，但写入文件失败',
        });
      }
      const instance: InstanceVo = await apiClient
        .post(`${BASE}/${tid}/instantiate`, body, INSTANTIATE_REQUEST)
        .catch((error: unknown) => {
          throw withTimeoutHint(error, TIMEOUT_HINT);
        });
      emitWithOut(o.json, instance, (writtenTo) => renderInstantiated(instance ?? {}, writtenTo), {
        file: out, force: o.force, content: instance?.renderedContent, failPrefix: `实例 #${instance?.id ?? '?'} 已创建，但写入文件失败`,
      });
    }));
}
