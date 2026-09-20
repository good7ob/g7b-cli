import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { InputError, emit, guarded, parseId } from '../../utils/cliHelpers';
import { checkOutTarget, emitWithOut } from './outFile';
import { UpgradePreviewVo, UpgradeVo, renderUpgrade, renderUpgradePreview } from './renderCheck';
import { withOutFlags, withVarFlags } from './useFlags';
import { USE_ERROR_CODES as CODES, buildPreviewBody } from './useInput';

const url = (id: number) => `/templates/instances/${id}`;

/**
 * `template upgrade <instanceId>`: is there a newer published version, and what changed. Read-only: an instance and the
 * objects it created are never modified automatically. `--preview` renders the new version with the instance's saved
 * variables (overridable) without creating anything.
 */
export function registerUpgradeCommands(tpl: Command): void {
  withOutFlags(withVarFlags(tpl.command('upgrade <instanceId>')), 'the previewed result (needs --preview)')
    .description('Check whether an instance has a newer published version (diff); --preview renders that version without creating anything')
    .option('--preview', 'Render the target version with the instance\'s saved variables (override with --var / --vars-file)')
    .option('--version <x.y.z>', 'With --preview: target version (default the latest published)')
    .option('--json', 'Output as JSON')
    .action((instanceId, o) => guarded('升级检查失败', CODES, async () => {
      const iid = parseId(instanceId, 'instanceId');
      if (!o.preview) {
        const extra = ['version', 'var', 'varsFile', 'out', 'force'].filter((k) => o[k] !== undefined);
        if (extra.length) throw new InputError('--version / --var / --vars-file / --out / --force 需要与 --preview 一起使用');
        const check: UpgradeVo = await apiClient.get(`${url(iid)}/upgrade`);
        return emit(o.json, check, () => renderUpgrade(check ?? {}));
      }
      const body = buildPreviewBody(o);
      const out = checkOutTarget(o);
      const preview: UpgradePreviewVo = await apiClient.post(`${url(iid)}/upgrade-preview`, body);
      emitWithOut(o.json, preview, (writtenTo) => renderUpgradePreview(preview ?? {}, writtenTo), {
        file: out, force: o.force, content: preview?.renderedContent, failPrefix: '预览已完成，但写入文件失败',
      });
    }));
}
