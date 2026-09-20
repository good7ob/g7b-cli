import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { collect, emit, guarded, parseId, withTimeoutHint } from '../../utils/cliHelpers';
import { PackageInstantiationVo, renderPackageInstantiation } from './renderUse';
import { withTargetFlags, withVarFlags } from './useFlags';
import { INSTANTIATE_REQUEST, TIMEOUT_HINT, USE_ERROR_CODES as CODES, buildPackageUseBody } from './useInput';

/** `template package use`: instantiate every template of a package (in `sort_order`) in ONE transaction. */
export function registerPackageUse(pkg: Command): void {
  withVarFlags(withTargetFlags(pkg.command('use <packageId>')))
    .description('Instantiate a whole package into your product (all-or-nothing; not idempotent — check `template instances --package` before retrying)')
    .option('--item <templateId:name=value>', 'Override one variable of one template of the package, repeatable (the shared --var / --vars-file apply to every template that defines them)', collect)
    .option('--json', 'Output as JSON')
    .action((packageId, o) => guarded('实例化模板包失败', CODES, async () => {
      const pid = parseId(packageId, 'packageId');
      const body = buildPackageUseBody(o);
      const result: PackageInstantiationVo = await apiClient
        .post(`/templates/packages/${pid}/instantiate`, body, INSTANTIATE_REQUEST)
        .catch((error: unknown) => {
          throw withTimeoutHint(error, TIMEOUT_HINT);
        });
      emit(o.json, result, () => renderPackageInstantiation(result ?? {}));
    }));
}
