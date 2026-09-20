/**
 * CLI-boundary validation for the Template Center part 2 commands (install / use / instances / deps / package use /
 * upgrade). Field names and limits mirror InstallDto, InstantiateDto, PackageInstantiateDto and UpgradePreviewDto
 * (com.remostudio.template); everything is checked here before the first request.
 */
import { ErrorCodeMap } from '../../utils/cliHelpers';
import { VarFlags } from './varsInput';
type Body = Record<string, unknown>;
/** T2 refines what the shared template codes mean when installing / instantiating (api-0091 §20). */
export declare const USE_ERROR_CODES: ErrorCodeMap;
/** Instantiation is transactional but NOT idempotent: after a timeout the server may already have created everything. */
export declare const TIMEOUT_HINT = "\u670D\u52A1\u7AEF\u53EF\u80FD\u5DF2\u6267\u884C\uFF0C\u8BF7\u5148\u7528 template instances \u6838\u5BF9\uFF0C\u52FF\u76F2\u76EE\u91CD\u8BD5";
/** Creating up to 200 tasks in one transaction can outlast the 30 s default. */
export declare const INSTANTIATE_REQUEST: {
    readonly timeout: 120000;
};
export interface TargetFlags {
    org?: string;
    product?: string;
    module?: string;
    suite?: string;
    start?: string;
    end?: string;
    withDeps?: boolean;
}
/** Which of the per-type target options a template type actually uses (the server ignores the rest). */
export declare const TARGET_USE: Record<string, {
    module?: 'required' | 'optional';
    suite?: true;
    dates?: true;
}>;
/** orgId / productId are mandatory; module / suite / dates / installDependencies only when given. */
export declare function buildTarget(o: TargetFlags): Body;
export declare const withoutUndefined: (body: Body) => Body;
export interface UseFlags extends TargetFlags, VarFlags {
    version?: string;
}
export declare function buildInstantiateBody(o: UseFlags): Body;
export interface PackageUseFlags extends TargetFlags, VarFlags {
    item?: string[];
}
export declare function buildPackageUseBody(o: PackageUseFlags): Body;
export declare function buildInstallBody(o: {
    org?: string;
    version?: string;
    withDeps?: boolean;
}): Body;
/** `template installed` / `template deps` query. */
export declare function buildInstalledParams(o: {
    org?: string;
    page?: string;
    pageSize?: string;
}): Record<string, number>;
export declare function buildDepsParams(o: {
    org?: string;
    version?: string;
}): Record<string, string | number>;
export interface InstanceListFlags {
    template?: string;
    type?: string;
    org?: string;
    product?: string;
    package?: string;
    page?: string;
    pageSize?: string;
}
export declare function buildInstanceListParams(o: InstanceListFlags): Record<string, string | number>;
export declare function buildPreviewBody(o: VarFlags & {
    version?: string;
}): Body;
export {};
//# sourceMappingURL=useInput.d.ts.map