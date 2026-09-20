"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerInstallCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const outFile_1 = require("./outFile");
const renderCheck_1 = require("./renderCheck");
const renderUse_1 = require("./renderUse");
const useInput_1 = require("./useInput");
const input_1 = require("./input");
const useFlags_1 = require("./useFlags");
const BASE = '/templates';
const withPaging = (cmd) => cmd
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-50)', '20');
/** install / uninstall / installed / deps / instances / instance: what I use, and what I created from it. */
function registerInstallCommands(tpl) {
    tpl
        .command('install <id>')
        .description('Install a template into your personal scope or an organization (idempotent; counts as "used" so you can review it)')
        .option('--org <orgId>', 'Install for this organization (you must be an active member); default personal scope')
        .option('--version <x.y.z>', 'Version to install (must have been published; default the current published one)')
        .option('--with-deps', 'Also install missing / outdated installable dependencies (same scope, same transaction)')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('安装模板失败', useInput_1.USE_ERROR_CODES, async () => {
        const tid = (0, cliHelpers_1.parseId)(id, 'id');
        const installed = await ApiClient_1.default.post(`${BASE}/${tid}/install`, (0, useInput_1.buildInstallBody)(o));
        (0, cliHelpers_1.emit)(o.json, installed, () => (0, renderUse_1.renderInstalled)(installed ?? {}));
    }));
    tpl
        .command('uninstall <id>')
        .description('Uninstall a template from a scope (soft delete; existing instances are kept; idempotent)')
        .option('--org <orgId>', 'Organization scope; default personal scope')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('卸载模板失败', useInput_1.USE_ERROR_CODES, async () => {
        const tid = (0, cliHelpers_1.parseId)(id, 'id');
        const orgId = o.org === undefined ? undefined : (0, cliHelpers_1.parseId)(o.org, '--org');
        const result = await ApiClient_1.default.delete(`${BASE}/${tid}/install${orgId ? `?orgId=${orgId}` : ''}`);
        const scope = orgId ? `组织 #${orgId}` : '个人范围';
        (0, cliHelpers_1.emit)(o.json, result, () => (result?.removed === false
            ? `模板 #${tid} 在${scope}本来就没有安装（未变化）`
            : `✓ 已卸载模板 #${tid}（${scope}）；已有实例保留`));
    }));
    withPaging(tpl.command('installed'))
        .description('Templates I installed (personal scope + my organizations), newest first')
        .option('--org <orgId>', 'Only this organization\'s installs (you must be a member)')
        .option('--json', 'Output as JSON')
        .action((o) => (0, cliHelpers_1.guarded)('获取已安装模板失败', useInput_1.USE_ERROR_CODES, async () => {
        const params = (0, useInput_1.buildInstalledParams)(o);
        const result = await ApiClient_1.default.get(`${BASE}/installed`, params);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderUse_1.renderInstalledList)(result, params.pageNum, params.pageSize));
    }));
    tpl
        .command('deps <id>')
        .description('Dependency check (read-only): which required / optional dependencies are missing, outdated or unavailable')
        .option('--org <orgId>', 'Also count this organization\'s installs (you must be a member)')
        .option('--version <x.y.z>', 'Check this version (default the published one)')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('依赖检查失败', useInput_1.USE_ERROR_CODES, async () => {
        const tid = (0, cliHelpers_1.parseId)(id, 'id');
        const check = await ApiClient_1.default.get(`${BASE}/${tid}/dependencies/check`, (0, useInput_1.buildDepsParams)(o));
        (0, cliHelpers_1.emit)(o.json, check, () => (0, renderCheck_1.renderDependencyCheck)(check ?? {}).join('\n'));
    }));
    withPaging(tpl.command('instances'))
        .description('Instances I created from templates, newest first (without the rendered content)')
        .option('--template <id>', 'Only this template')
        .option('--type <type>', `Only this template type (${(0, input_1.oneOf)(input_1.TEMPLATE_TYPES)})`)
        .option('--org <orgId>', 'Only this organization')
        .option('--product <productId>', 'Only this product')
        .option('--package <packageId>', 'Only instances created through this package')
        .option('--json', 'Output as JSON')
        .action((o) => (0, cliHelpers_1.guarded)('获取实例列表失败', useInput_1.USE_ERROR_CODES, async () => {
        const params = (0, useInput_1.buildInstanceListParams)(o);
        const result = await ApiClient_1.default.get(`${BASE}/instances`, params);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderUse_1.renderInstanceList)(result, Number(params.pageNum), Number(params.pageSize)));
    }));
    (0, useFlags_1.withOutFlags)(tpl.command('instance <id>'), 'the rendered result (document body, or the rendered JSON)')
        .description('Show one instance of mine: variables, created objects and the rendered result (documents in full)')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('获取实例失败', useInput_1.USE_ERROR_CODES, async () => {
        const iid = (0, cliHelpers_1.parseId)(id, 'id');
        const out = (0, outFile_1.checkOutTarget)(o);
        const instance = await ApiClient_1.default.get(`${BASE}/instances/${iid}`);
        (0, outFile_1.emitWithOut)(o.json, instance, (writtenTo) => (0, renderUse_1.renderInstance)(instance ?? {}, writtenTo), {
            file: out, force: o.force, content: instance?.renderedContent, failPrefix: `实例 #${iid} 已读取，但写入文件失败`,
        });
    }));
}
exports.registerInstallCommands = registerInstallCommands;
//# sourceMappingURL=installCommands.js.map