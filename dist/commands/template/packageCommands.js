"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPackageCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("./input");
const packageInput_1 = require("./packageInput");
const renderMisc_1 = require("./renderMisc");
const BASE = '/templates/packages';
const ITEM_HELP = 'Template in the package: <templateId>[:<constraint>], repeatable (max 30); constraint = * | x.y.z | ^x.y.z | ~x.y.z | >=x.y.z';
function withPackageFields(cmd) {
    return cmd
        .option('--description <text>', 'Description (max 2000 chars)')
        .option('--visibility <v>', `Visibility (${(0, input_1.oneOf)(input_1.VISIBILITIES)}; ORGANIZATION needs --org)`)
        .option('--item <templateId[:constraint]>', ITEM_HELP, cliHelpers_1.collect)
        .option('--json', 'Output as JSON');
}
/** `template package create|get|update|delete|list|publish|archive` — bundles of templates (no content of their own, no review). */
function registerPackageCommands(tpl) {
    const pkg = tpl.command('package').description('Template packages: a named bundle of templates');
    withPackageFields(pkg.command('create'))
        .description('Create a DRAFT package (personal, or an organization package with --org)')
        .requiredOption('--name <name>', 'Name (max 100 chars)')
        .option('--org <orgId>', 'Create an organization package (you must be its owner/admin)')
        .action((o) => (0, cliHelpers_1.guarded)('创建模板包失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const created = await ApiClient_1.default.post(BASE, (0, packageInput_1.buildPackageCreateBody)(o));
        (0, cliHelpers_1.emit)(o.json, created, () => `✓ 模板包已创建 (${created?.status ?? 'DRAFT'}): #${created?.id ?? '-'} ${created?.name ?? o.name}`);
    }));
    pkg
        .command('get <id>')
        .description('Show a package with its items (item names are blank when you cannot see that template)')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('获取模板包失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const detail = await ApiClient_1.default.get(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}`);
        (0, cliHelpers_1.emit)(o.json, detail, () => (0, renderMisc_1.renderPackage)(detail));
    }));
    withPackageFields(pkg.command('update <id>'))
        .description('Update a package (omitted flags stay unchanged; --item replaces ALL items)')
        .option('--name <name>', 'Name (max 100 chars)')
        .option('--clear-items', 'Remove all items')
        .action((id, o) => (0, cliHelpers_1.guarded)('更新模板包失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const updated = await ApiClient_1.default.put(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}`, (0, packageInput_1.buildPackageUpdateBody)(o));
        (0, cliHelpers_1.emit)(o.json, updated, () => `✓ 模板包已更新: #${id}`);
    }));
    pkg
        .command('delete <id>')
        .description('Delete a package (soft delete; only DRAFT / ARCHIVED)')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('删除模板包失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const pid = (0, cliHelpers_1.parseId)(id, 'id');
        await ApiClient_1.default.delete(`${BASE}/${pid}`);
        (0, cliHelpers_1.emit)(o.json, { deleted: true, id: pid }, () => `✓ 模板包已删除: #${pid}`);
    }));
    pkg
        .command('list')
        .description('Package library (published, visible to you); --mine or --org <id> for your own / an organization\'s')
        .option('-k, --keyword <text>', 'Search the library by name')
        .option('--mine', 'Packages I created (any status)')
        .option('--org <orgId>', 'Packages of an organization')
        .option('-p, --page <num>', 'Page number', '1')
        .option('--page-size <num>', 'Items per page (1-50)', '20')
        .option('--json', 'Output as JSON')
        .action((o) => (0, cliHelpers_1.guarded)('获取模板包列表失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const { url, params } = (0, packageInput_1.buildPackageListRequest)(o);
        const result = await ApiClient_1.default.get(url, params);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderMisc_1.renderPackageList)(result, Number(params.pageNum), Number(params.pageSize)));
    }));
    for (const [name, verb, past] of [['publish', '发布', '已发布'], ['archive', '归档', '已归档']]) {
        pkg
            .command(`${name} <id>`)
            .description(name === 'publish' ? 'Publish a DRAFT package (every item must be PUBLISHED and at least as visible as the package)' : 'Archive a package')
            .option('--json', 'Output as JSON')
            .action((id, o) => (0, cliHelpers_1.guarded)(`${verb}模板包失败`, input_1.TEMPLATE_ERROR_CODES, async () => {
            const result = await ApiClient_1.default.post(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/${name}`);
            (0, cliHelpers_1.emit)(o.json, result, () => `✓ 模板包 #${id} ${past}${result?.status ? ` (${result.status})` : ''}`);
        }));
    }
}
exports.registerPackageCommands = registerPackageCommands;
//# sourceMappingURL=packageCommands.js.map