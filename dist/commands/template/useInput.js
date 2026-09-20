"use strict";
/**
 * CLI-boundary validation for the Template Center part 2 commands (install / use / instances / deps / package use /
 * upgrade). Field names and limits mirror InstallDto, InstantiateDto, PackageInstantiateDto and UpgradePreviewDto
 * (com.remostudio.template); everything is checked here before the first request.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPreviewBody = exports.buildInstanceListParams = exports.buildDepsParams = exports.buildInstalledParams = exports.buildInstallBody = exports.buildPackageUseBody = exports.buildInstantiateBody = exports.withoutUndefined = exports.buildTarget = exports.TARGET_USE = exports.INSTANTIATE_REQUEST = exports.TIMEOUT_HINT = exports.USE_ERROR_CODES = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("./input");
const varsInput_1 = require("./varsInput");
const versionInput_1 = require("./versionInput");
/** T2 refines what the shared template codes mean when installing / instantiating (api-0091 §20). */
exports.USE_ERROR_CODES = {
    ...input_1.TEMPLATE_ERROR_CODES,
    1000: '缺少必填参数（--org / --product 必填；TASK 类型必须带 --module）',
    1001: '参数值不合法：变量缺失 / 未知 / 类型不符；目标模块或用例目录不属于该产品；渲染结果不合法或超过 2 MB；超出数量上限',
    1002: '模板 / 版本 / 包 / 实例不存在或对你不可见；或产品不存在 / 不属于该组织',
    1006: '已存在（如 RELEASE 渲染出的版本号在该产品下已有）',
    1007: '当前状态不允许：模板未发布 / 已下架 / 已归档；缺必需依赖（可加 --with-deps）；包条目不满足版本约束；该类型暂无实例化处理器',
    2000: '你不是目标组织的活跃成员',
};
/** Instantiation is transactional but NOT idempotent: after a timeout the server may already have created everything. */
exports.TIMEOUT_HINT = '服务端可能已执行，请先用 template instances 核对，勿盲目重试';
/** Creating up to 200 tasks in one transaction can outlast the 30 s default. */
exports.INSTANTIATE_REQUEST = { timeout: 120000 };
/** Which of the per-type target options a template type actually uses (the server ignores the rest). */
exports.TARGET_USE = {
    TASK: { module: 'required' },
    PRD: { module: 'optional' },
    TEST: { suite: true },
    RELEASE: { dates: true },
};
function optionalId(raw, label) {
    return raw === undefined ? undefined : (0, cliHelpers_1.parseId)(raw, label);
}
function dateRange(start, end) {
    const plannedStartDate = start === undefined ? undefined : (0, cliHelpers_1.parseDate)(start, '--start');
    const plannedEndDate = end === undefined ? undefined : (0, cliHelpers_1.parseDate)(end, '--end');
    if (plannedStartDate && plannedEndDate && plannedEndDate < plannedStartDate) {
        throw new cliHelpers_1.InputError(`--end (${plannedEndDate}) 不能早于 --start (${plannedStartDate})`);
    }
    return { plannedStartDate, plannedEndDate };
}
/** orgId / productId are mandatory; module / suite / dates / installDependencies only when given. */
function buildTarget(o) {
    return (0, exports.withoutUndefined)({
        orgId: (0, cliHelpers_1.parseId)(o.org, '--org'),
        productId: (0, cliHelpers_1.parseId)(o.product, '--product'),
        moduleId: optionalId(o.module, '--module'),
        suiteId: optionalId(o.suite, '--suite'),
        ...dateRange(o.start, o.end),
        installDependencies: o.withDeps ? true : undefined,
    });
}
exports.buildTarget = buildTarget;
const withoutUndefined = (body) => Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
exports.withoutUndefined = withoutUndefined;
function buildInstantiateBody(o) {
    return (0, exports.withoutUndefined)({
        ...buildTarget(o),
        version: o.version === undefined ? undefined : (0, versionInput_1.requireSemver)(o.version, '--version'),
        variables: (0, varsInput_1.resolveVariables)(o),
    });
}
exports.buildInstantiateBody = buildInstantiateBody;
function buildPackageUseBody(o) {
    const overrides = o.item?.length ? (0, varsInput_1.parseItemOverrides)(o.item) : [];
    return (0, exports.withoutUndefined)({
        ...buildTarget(o),
        variables: (0, varsInput_1.resolveVariables)(o),
        items: overrides.length ? overrides : undefined,
    });
}
exports.buildPackageUseBody = buildPackageUseBody;
function buildInstallBody(o) {
    return (0, exports.withoutUndefined)({
        orgId: optionalId(o.org, '--org'),
        version: o.version === undefined ? undefined : (0, versionInput_1.requireSemver)(o.version, '--version'),
        installDependencies: o.withDeps ? true : undefined,
    });
}
exports.buildInstallBody = buildInstallBody;
/** `template installed` / `template deps` query. */
function buildInstalledParams(o) {
    return (0, exports.withoutUndefined)({ ...(0, input_1.pageParams)(o), orgId: optionalId(o.org, '--org') });
}
exports.buildInstalledParams = buildInstalledParams;
function buildDepsParams(o) {
    return (0, exports.withoutUndefined)({
        orgId: optionalId(o.org, '--org'),
        version: o.version === undefined ? undefined : (0, versionInput_1.requireSemver)(o.version, '--version'),
    });
}
exports.buildDepsParams = buildDepsParams;
function buildInstanceListParams(o) {
    return (0, exports.withoutUndefined)({
        ...(0, input_1.pageParams)(o),
        templateId: optionalId(o.template, '--template'),
        type: o.type === undefined ? undefined : (0, input_1.upperOneOf)(o.type, input_1.TEMPLATE_TYPES, '--type'),
        orgId: optionalId(o.org, '--org'),
        productId: optionalId(o.product, '--product'),
        packageId: optionalId(o.package, '--package'),
    });
}
exports.buildInstanceListParams = buildInstanceListParams;
function buildPreviewBody(o) {
    return (0, exports.withoutUndefined)({
        version: o.version === undefined ? undefined : (0, versionInput_1.requireSemver)(o.version, '--version'),
        variables: (0, varsInput_1.resolveVariables)(o),
    });
}
exports.buildPreviewBody = buildPreviewBody;
//# sourceMappingURL=useInput.js.map