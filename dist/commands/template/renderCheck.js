"use strict";
/** Renderers for dependency checks and the version-upgrade prompt / preview (api-0091 §16, §18). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderUpgradePreview = exports.renderUpgrade = exports.renderDependencyCheck = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const renderBody_1 = require("./renderBody");
const renderVersion_1 = require("./renderVersion");
const STATUS_LABEL = {
    OK: 'OK', MISSING: '缺失', OUTDATED: '过旧', UNAVAILABLE: '不可用',
};
/** Table of the resolved dependency tree; `installable` items are what `--with-deps` would install. */
function renderDependencyCheck(check) {
    const items = check.items ?? [];
    const verdict = check.satisfied
        ? '✓ 必需依赖全部满足'
        : `✗ 缺少 ${(0, cliHelpers_1.dash)(check.missingRequired)} 个必需依赖（--with-deps 可自动安装其中「可安装」的）`;
    const rows = [['模板', '类型', '最低版本', '已装版本', '最新发布', '状态', '可安装', '深度', '被依赖于']].concat(items.map((i) => [
        `#${(0, cliHelpers_1.dash)(i.templateId)} ${(0, cliHelpers_1.dash)(i.templateName)}`, (0, cliHelpers_1.dash)(i.kind), (0, cliHelpers_1.dash)(i.minVersion), (0, cliHelpers_1.dash)(i.installedVersion), (0, cliHelpers_1.dash)(i.publishedVersion),
        i.status ? STATUS_LABEL[i.status] ?? i.status : cliHelpers_1.DASH, i.installable ? '是' : '否', (0, cliHelpers_1.dash)(i.depth), `#${(0, cliHelpers_1.dash)(i.requiredBy)}`,
    ]));
    return [
        `依赖检查: 模板 #${(0, cliHelpers_1.dash)(check.templateId)} v${(0, cliHelpers_1.dash)(check.version)}  ${verdict}`,
        ...(items.length ? [(0, cliHelpers_1.renderTable)(rows, { 0: { truncate: 36 } })] : ['（没有依赖）']),
        ...(check.warnings ?? []).map((w) => `⚠ ${w}`),
    ];
}
exports.renderDependencyCheck = renderDependencyCheck;
const DEFAULT_NOTE = '已有实例与它创建的业务对象不会被自动修改；如需使用新版本，请用新版本重新实例化';
function renderUpgrade(v) {
    const head = `实例 #${(0, cliHelpers_1.dash)(v.instanceId)}  模板 #${(0, cliHelpers_1.dash)(v.templateId)} ${(0, cliHelpers_1.dash)(v.templateName)}  当前 v${(0, cliHelpers_1.dash)(v.currentVersion)}  最新已发布 ${v.latestVersion ? `v${v.latestVersion}` : cliHelpers_1.DASH}`;
    const body = v.upgradeAvailable
        ? ['✓ 有新版本可用', ...(v.diff ? ['', (0, renderVersion_1.renderDiff)(v.diff)] : []), '', `预览: good7ob template upgrade ${(0, cliHelpers_1.dash)(v.instanceId)} --preview [--var name=value]`]
        : [`✗ 没有可升级的版本${v.reason ? `：${v.reason}` : ''}`];
    return [head, ...body, '', `注意: ${v.note || DEFAULT_NOTE}`].join('\n');
}
exports.renderUpgrade = renderUpgrade;
function renderUpgradePreview(v, writtenTo) {
    const vars = Object.entries(v.variables ?? {});
    return [
        `升级预览: 实例 #${(0, cliHelpers_1.dash)(v.instanceId)}  v${(0, cliHelpers_1.dash)(v.from)} → v${(0, cliHelpers_1.dash)(v.to)}（仅渲染，未创建任何对象，未修改实例）`,
        ...(vars.length ? [`变量 (${vars.length})`, (0, cliHelpers_1.renderTable)([['名称', '值']].concat(vars.map(([k, val]) => [k, (0, cliHelpers_1.dash)(val)])), { 1: { truncate: 80 } })] : [`变量: ${cliHelpers_1.DASH}`]),
        '', ...(0, renderBody_1.resultLines)(v.renderedContent, writtenTo),
        '', `确认后请用新版本重新实例化: good7ob template use <templateId> --version ${(0, cliHelpers_1.dash)(v.to)} --org <N> --product <N>`,
    ].join('\n');
}
exports.renderUpgradePreview = renderUpgradePreview;
//# sourceMappingURL=renderCheck.js.map