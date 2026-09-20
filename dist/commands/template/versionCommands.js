"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerVersionCommands = exports.withPayloadFlags = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("./input");
const renderVersion_1 = require("./renderVersion");
const versionInput_1 = require("./versionInput");
const BASE = '/templates';
const versionUrl = (id, version) => `${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/versions/${(0, versionInput_1.requireSemver)(version, 'version')}`;
/** JSON payload flags shared by `create`, `version add` and `version update`. */
function withPayloadFlags(cmd) {
    return cmd
        .option('--changelog <text>', 'Change log (max 5000 chars)')
        .option('--content-file <file.json>', 'Content JSON file (structure per template type, see api-0091; max 1 MB, depth 32, 50,000 values)')
        .option('--content <json>', 'Content as an inline JSON string (same limits; alternative to --content-file)')
        .option('--variables-file <file.json>', 'Variables JSON array file (max 50 variables)')
        .option('--compatibility-file <file.json>', 'Compatibility JSON object file (max 4 KB)');
}
exports.withPayloadFlags = withPayloadFlags;
function submitOutcome(v, version) {
    if (v?.status === 'PUBLISHED')
        return `✓ 版本 ${version} 已发布 (PUBLISHED)`;
    if (v?.status === 'REVIEWING')
        return `✓ 版本 ${version} 已提交审核 (REVIEWING)：内容已冻结，等待平台管理员审核`;
    return `✓ 版本 ${version} 已提交${v?.status ? ` (${v.status})` : ''}`;
}
function registerVersion(tpl) {
    const version = tpl.command('version').description('Template versions (x.y.z): draft, edit, list, submit');
    withPayloadFlags(version.command('add <id>'))
        .description('Add a DRAFT version (its number must be numerically greater than every existing version)')
        .requiredOption('--version <x.y.z>', 'Version number, e.g. 1.0.0')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('创建版本失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const tid = (0, cliHelpers_1.parseId)(id, 'id');
        const body = (0, versionInput_1.buildVersionAddBody)(o);
        const created = await ApiClient_1.default.post(`${BASE}/${tid}/versions`, body);
        (0, cliHelpers_1.emit)(o.json, created, () => `✓ 版本已创建 (${created?.status ?? 'DRAFT'}): 模板 #${tid} ${body.version}`);
    }));
    withPayloadFlags(version.command('update <id> <version>'))
        .description('Edit a DRAFT version (omitted flags stay unchanged; content and variables are re-validated together)')
        .option('--json', 'Output as JSON')
        .action((id, ver, o) => (0, cliHelpers_1.guarded)('更新版本失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const url = versionUrl(id, ver);
        const updated = await ApiClient_1.default.put(url, (0, versionInput_1.buildVersionUpdateBody)(o));
        (0, cliHelpers_1.emit)(o.json, updated, () => `✓ 版本已更新: 模板 #${id} ${ver}`);
    }));
    version
        .command('list <id>')
        .description('List versions (no content); non-managers only see versions that were published')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('获取版本列表失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const result = await ApiClient_1.default.get(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/versions`);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderVersion_1.renderVersionList)(result));
    }));
    version
        .command('get <id> <version>')
        .description('Show one version with content, variables and dependencies')
        .option('--json', 'Output as JSON')
        .action((id, ver, o) => (0, cliHelpers_1.guarded)('获取版本失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const detail = await ApiClient_1.default.get(versionUrl(id, ver));
        (0, cliHelpers_1.emit)(o.json, detail, () => (0, renderVersion_1.renderVersion)(detail));
    }));
    version
        .command('delete <id> <version>')
        .description('Delete a DRAFT version (soft delete, frees the version number)')
        .option('--json', 'Output as JSON')
        .action((id, ver, o) => (0, cliHelpers_1.guarded)('删除版本失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const url = versionUrl(id, ver);
        await ApiClient_1.default.delete(url);
        (0, cliHelpers_1.emit)(o.json, { deleted: true, id: Number(id), version: ver }, () => `✓ 版本已删除: 模板 #${id} ${ver}`);
    }));
    version
        .command('submit <id> <version>')
        .description('Submit a DRAFT version: PRIVATE / ORGANIZATION publish at once, PUBLIC goes to platform review (content freezes)')
        .option('--json', 'Output as JSON')
        .action((id, ver, o) => (0, cliHelpers_1.guarded)('提交版本失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const submitted = await ApiClient_1.default.post(`${versionUrl(id, ver)}/submit`);
        (0, cliHelpers_1.emit)(o.json, submitted, () => submitOutcome(submitted, ver));
    }));
}
function registerDependency(tpl) {
    const dep = tpl.command('dependency').description('Dependencies of a DRAFT version (max 20, no cycles; PUBLIC templates may only depend on PUBLIC ones)');
    dep
        .command('list <id> <version>')
        .description('List the dependencies of a version')
        .option('--json', 'Output as JSON')
        .action((id, ver, o) => (0, cliHelpers_1.guarded)('获取依赖失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const result = await ApiClient_1.default.get(`${versionUrl(id, ver)}/dependencies`);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderVersion_1.renderDependencyList)(result));
    }));
    dep
        .command('set <id> <version>')
        .description('Replace ALL dependencies of a DRAFT version from a JSON file: [{"requiredTemplateId":7,"minVersion":"1.0.0","kind":"requires"}]')
        .requiredOption('--file <deps.json>', 'Dependencies file (an array, or {"dependencies": [...]}; max 20)')
        .option('--json', 'Output as JSON')
        .action((id, ver, o) => (0, cliHelpers_1.guarded)('设置依赖失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const url = versionUrl(id, ver);
        const dependencies = (0, versionInput_1.loadDependencies)(o.file);
        const result = await ApiClient_1.default.put(`${url}/dependencies`, { dependencies });
        (0, cliHelpers_1.emit)(o.json, result, () => `✓ 依赖已替换: 模板 #${id} ${ver}，共 ${dependencies.length} 个\n${(0, renderVersion_1.renderDependencyList)(result)}`);
    }));
    dep
        .command('add <id> <version>')
        .description('Add one dependency to a DRAFT version')
        .requiredOption('--template <id>', 'Required template id')
        .option('--min-version <x.y.z>', 'Minimum version of the required template')
        .option('--kind <kind>', `Dependency kind (${versionInput_1.DEPENDENCY_KINDS.join('|')}, default requires)`)
        .option('--json', 'Output as JSON')
        .action((id, ver, o) => (0, cliHelpers_1.guarded)('添加依赖失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const url = versionUrl(id, ver);
        const result = await ApiClient_1.default.post(`${url}/dependencies`, (0, versionInput_1.buildDependency)(o));
        (0, cliHelpers_1.emit)(o.json, result, () => `✓ 依赖已添加: 模板 #${id} ${ver} → #${o.template}`);
    }));
    dep
        .command('rm <id> <version> <dependencyId>')
        .description('Remove one dependency (dependencyId from `dependency list`)')
        .option('--json', 'Output as JSON')
        .action((id, ver, depId, o) => (0, cliHelpers_1.guarded)('删除依赖失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const url = versionUrl(id, ver);
        const did = (0, cliHelpers_1.parseId)(depId, 'dependencyId');
        const result = await ApiClient_1.default.delete(`${url}/dependencies/${did}`);
        (0, cliHelpers_1.emit)(o.json, result ?? { deleted: true, id: did }, () => `✓ 依赖已删除: #${did}`);
    }));
}
function registerVersionCommands(tpl) {
    registerVersion(tpl);
    registerDependency(tpl);
    tpl
        .command('diff <id> <from> <to>')
        .description('What changed between two versions (content and variables: added / changed / removed)')
        .option('--json', 'Output as JSON')
        .action((id, from, to, o) => (0, cliHelpers_1.guarded)('获取版本差异失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const url = versionUrl(id, from);
        const result = await ApiClient_1.default.get(`${url}/diff`, { to: (0, versionInput_1.requireSemver)(to, 'to') });
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderVersion_1.renderDiff)(result));
    }));
}
exports.registerVersionCommands = registerVersionCommands;
//# sourceMappingURL=versionCommands.js.map