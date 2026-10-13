import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { collect, emit, guarded, parseId, withTimeoutHint } from '../../utils/cliHelpers';
import { PackageInstantiationVo, renderPackageInstantiation } from './renderUse';
import { withTargetFlags, withVarFlags } from './useFlags';
import { IDEMPOTENCY_OPTION, INSTANTIATE_REQUEST, USE_ERROR_CODES as CODES, buildPackageUseBody, resolveIdempotencyKey, timeoutHint } from './useInput';

/** `template package use`: instantiate every template of a package (in `sort_order`) in ONE transaction. */
export function registerPackageUse(pkg: Command): void {
  withVarFlags(withTargetFlags(pkg.command('use <packageId>')))
    .description('Instantiate a whole package into your product (all-or-nothing; idempotent with --idempotency-key, so a retry after a timeout never creates twice)')
    .option('--item <templateId:name=value>', 'Override one variable of one template of the package, repeatable (the shared --var / --vars-file apply to every template that defines them)', collect)
    .option('--item-opt <templateId:key=value>', 'Override the target of one template of the package, repeatable; key is module | suite | start | end (e.g. 5:module=12, 7:suite=3, 9:start=2026-10-01); wins over --module / --suite / --start / --end', collect)
    .option(...IDEMPOTENCY_OPTION)
    .option('--json', 'Output as JSON')
    .action((packageId, o) => guarded('实例化模板包失败', CODES, async () => {
      const pid = parseId(packageId, 'packageId');
      const body = buildPackageUseBody(o);
      const key = resolveIdempotencyKey(o.idempotencyKey);
      const result: PackageInstantiationVo = await apiClient
        .post(`/templates/packages/${pid}/instantiate`, { ...body, idempotencyKey: key }, INSTANTIATE_REQUEST)
        .catch((error: unknown) => {
          throw withTimeoutHint(error, timeoutHint(key));
        });
      emit(o.json, result, () => renderPackageInstantiation(result ?? {}));
    }));
}
