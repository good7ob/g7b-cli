"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTemplateCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const adminCommands_1 = require("./adminCommands");
const input_1 = require("./input");
const packageCommands_1 = require("./packageCommands");
const render_1 = require("./render");
const renderMisc_1 = require("./renderMisc");
const reviewCommands_1 = require("./reviewCommands");
const versionCommands_1 = require("./versionCommands");
const versionInput_1 = require("./versionInput");
const renderVersion_1 = require("./renderVersion");
/**
 * Template Center commands (api-0091, backend `/templates`): browse the catalog, manage my / my org's templates
 * and their versions, publish, favorite, review, bundle templates into packages, and (platform admins only)
 * moderate submissions. Versions, dependencies and diff live in versionCommands.ts, reviews in reviewCommands.ts,
 * packages in packageCommands.ts and the admin group in adminCommands.ts.
 *
 * Business errors come back as HTTP 200 + non-200 `code`; ApiClient throws on those and `guarded` maps them.
 */
const BASE = '/templates';
function withPaging(cmd) {
    return cmd
        .option('-p, --page <num>', 'Page number', '1')
        .option('--page-size <num>', 'Items per page (1-50)', '20');
}
/** Shared metadata flags of create / update. */
function withMeta(cmd) {
    return cmd
        .option('--description <text>', 'Description (max 2000 chars)')
        .option('--category <id>', 'Category id (see `template categories`)')
        .option('--visibility <v>', `Visibility (${(0, input_1.oneOf)(input_1.VISIBILITIES)}; ORGANIZATION needs --org)`)
        .option('--tags <a,b>', 'Tags, comma separated (max 10, each 1-30 chars); on update they replace the existing tags')
        .option('--license <l>', `License (${(0, input_1.oneOf)(input_1.LICENSES)})`);
}
function registerBrowse(tpl) {
    withPaging(tpl.command('search'))
        .description('Search the catalog: published templates visible to you (filters combine with AND)')
        .option('-k, --keyword <text>', 'Match name / description / tag')
        .option('--type <type>', `Template type (${(0, input_1.oneOf)(input_1.TEMPLATE_TYPES)})`)
        .option('--category <id>', 'Category id (includes sub-categories)')
        .option('--tag <name>', 'Tag name, repeatable (all must match, max 10)', cliHelpers_1.collect)
        .option('--industry <name>', 'Industry tag')
        .option('--tech-stack <name>', 'Tech-stack tag')
        .option('--language <name>', 'Language tag')
        .option('--platform <name>', 'Platform tag')
        .option('--pricing <p>', 'Pricing type (FREE|ONE_TIME|SUBSCRIPTION|PRIVATE; only FREE exists today)')
        .option('--min-rating <n>', 'Minimum average rating (0-5)')
        .option('--author <userId>', 'Only templates created by this user')
        .option('--official', 'Only official templates')
        .option('--no-official', 'Only non-official templates')
        .option('--sort <s>', `Sort (${(0, input_1.oneOf)(input_1.SORTS)}, default latest)`)
        .option('--json', 'Output as JSON')
        .action((o) => (0, cliHelpers_1.guarded)('搜索模板失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const { url, params } = (0, input_1.buildSearchRequest)(o);
        const result = await ApiClient_1.default.get(url, params);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, render_1.renderTemplateList)(result, Number(params.pageNum), Number(params.pageSize)));
    }));
    tpl
        .command('get <id>')
        .description('Show a template with its published version (content + variables + dependencies); --version shows that version instead')
        .option('--version <x.y.z>', 'Show this version (like `template version get`)')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('获取模板失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const tid = (0, cliHelpers_1.parseId)(id, 'id');
        if (o.version !== undefined) {
            const version = await ApiClient_1.default.get(`${BASE}/${tid}/versions/${(0, versionInput_1.requireSemver)(o.version, '--version')}`);
            return (0, cliHelpers_1.emit)(o.json, version, () => (0, renderVersion_1.renderVersion)(version));
        }
        const detail = await ApiClient_1.default.get(`${BASE}/${tid}`);
        (0, cliHelpers_1.emit)(o.json, detail, () => (0, render_1.renderTemplateDetail)(detail));
    }));
    withPaging(tpl.command('mine'))
        .description('Templates I created (any status)')
        .option('--status <s>', `Filter by status (${(0, input_1.oneOf)(input_1.STATUSES)})`)
        .option('--type <type>', `Filter by type (${(0, input_1.oneOf)(input_1.TEMPLATE_TYPES)})`)
        .option('--json', 'Output as JSON')
        .action((o) => (0, cliHelpers_1.guarded)('获取我的模板失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const params = (0, input_1.buildListParams)(o);
        const result = await ApiClient_1.default.get(`${BASE}/mine`, params);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, render_1.renderTemplateList)(result, Number(params.pageNum), Number(params.pageSize), '你还没有创建模板。'));
    }));
    withPaging(tpl.command('org <orgId>'))
        .description('Templates of an organization (members see the library scope; owners/admins also see drafts)')
        .option('--status <s>', `Filter by status (${(0, input_1.oneOf)(input_1.STATUSES)})`)
        .option('--type <type>', `Filter by type (${(0, input_1.oneOf)(input_1.TEMPLATE_TYPES)})`)
        .option('--json', 'Output as JSON')
        .action((orgId, o) => (0, cliHelpers_1.guarded)('获取组织模板失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const params = (0, input_1.buildListParams)(o);
        const result = await ApiClient_1.default.get(`${BASE}/org/${(0, cliHelpers_1.parseId)(orgId, 'orgId')}`, params);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, render_1.renderTemplateList)(result, Number(params.pageNum), Number(params.pageSize), '该组织没有模板。'));
    }));
    withPaging(tpl.command('favorites'))
        .description('My favorites that are still in the library')
        .option('--json', 'Output as JSON')
        .action((o) => (0, cliHelpers_1.guarded)('获取收藏失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const params = (0, input_1.pageParams)(o);
        const result = await ApiClient_1.default.get(`${BASE}/favorites`, params);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, render_1.renderTemplateList)(result, params.pageNum, params.pageSize, '还没有收藏。'));
    }));
    tpl
        .command('categories')
        .description('Category tree (one root per template type)')
        .option('--type <type>', `Only this template type (${(0, input_1.oneOf)(input_1.TEMPLATE_TYPES)})`)
        .option('--json', 'Output as JSON')
        .action((o) => (0, cliHelpers_1.guarded)('获取分类失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const params = o.type ? { type: (0, input_1.upperOneOf)(o.type, input_1.TEMPLATE_TYPES, '--type') } : undefined;
        const result = await ApiClient_1.default.get(`${BASE}/categories`, params);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderMisc_1.renderCategories)(result));
    }));
    tpl
        .command('tags')
        .description('Popular tags on public published templates')
        .option('--kind <kind>', `Tag kind (${(0, input_1.oneOf)(input_1.TAG_KINDS)})`)
        .option('-k, --keyword <text>', 'Filter by keyword')
        .option('--limit <n>', 'Max tags (1-100, default 50)')
        .option('--json', 'Output as JSON')
        .action((o) => (0, cliHelpers_1.guarded)('获取标签失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const result = await ApiClient_1.default.get(`${BASE}/tags`, (0, input_1.buildTagsParams)(o));
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderMisc_1.renderTags)(result));
    }));
}
function registerManage(tpl) {
    (0, versionCommands_1.withPayloadFlags)(withMeta(tpl.command('create')))
        .description('Create a template (personal, or an organization template with --org); with --content also creates the first DRAFT version')
        .requiredOption('--name <name>', 'Name (max 100 chars, unique per owner)')
        .requiredOption('--type <type>', `Template type (${(0, input_1.oneOf)(input_1.TEMPLATE_TYPES)})`)
        .option('--org <orgId>', 'Create an organization template (you must be its owner/admin)')
        .option('--version <x.y.z>', 'First version number (default 1.0.0; needs --content)')
        .option('--json', 'Output as JSON')
        .action((o) => (0, cliHelpers_1.guarded)('创建模板失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const created = await ApiClient_1.default.post(BASE, (0, input_1.buildCreateBody)(o));
        (0, cliHelpers_1.emit)(o.json, created, () => `✓ 模板已创建 (${created?.status ?? '-'}): #${created?.id ?? '-'} ${created?.name ?? o.name}`);
    }));
    withMeta(tpl.command('update <id>'))
        .description('Update template metadata (omitted flags stay unchanged; content lives in versions)')
        .option('--name <name>', 'Name (max 100 chars)')
        .option('--clear-tags', 'Remove all tags')
        .option('--resubmit-for-review', 'Needed to make a published, never-reviewed template PUBLIC: it goes back to DRAFT for platform review')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('更新模板失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const updated = await ApiClient_1.default.put(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}`, (0, input_1.buildUpdateBody)(o));
        (0, cliHelpers_1.emit)(o.json, updated, () => `✓ 模板已更新: #${id}`);
    }));
    tpl
        .command('delete <id>')
        .description('Delete a template (soft delete; only DRAFT / ARCHIVED with no instances)')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('删除模板失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const tid = (0, cliHelpers_1.parseId)(id, 'id');
        await ApiClient_1.default.delete(`${BASE}/${tid}`);
        (0, cliHelpers_1.emit)(o.json, { deleted: true, id: tid }, () => `✓ 模板已删除: #${tid}`);
    }));
    for (const [name, past] of [['archive', '已归档'], ['unarchive', '已恢复']]) {
        tpl
            .command(`${name} <id>`)
            .description(name === 'archive' ? 'Archive a template (DRAFT / REJECTED / PUBLISHED)' : 'Restore an archived template (PUBLISHED if it has a published version, else DRAFT)')
            .option('--json', 'Output as JSON')
            .action((id, o) => (0, cliHelpers_1.guarded)(`${name === 'archive' ? '归档' : '恢复'}模板失败`, input_1.TEMPLATE_ERROR_CODES, async () => {
            const result = await ApiClient_1.default.post(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/${name}`);
            (0, cliHelpers_1.emit)(o.json, result, () => `✓ 模板 #${id} ${past}${result?.status ? ` → ${result.status}` : ''}`);
        }));
    }
    for (const [name, verb] of [['favorite', '收藏'], ['unfavorite', '取消收藏']]) {
        tpl
            .command(`${name} <id>`)
            .description(name === 'favorite' ? 'Favorite a template (idempotent; it must be in your library)' : 'Remove a template from favorites (idempotent)')
            .option('--json', 'Output as JSON')
            .action((id, o) => (0, cliHelpers_1.guarded)(`${verb}失败`, input_1.TEMPLATE_ERROR_CODES, async () => {
            const tid = (0, cliHelpers_1.parseId)(id, 'id');
            const result = name === 'favorite'
                ? await ApiClient_1.default.post(`${BASE}/${tid}/favorite`)
                : await ApiClient_1.default.delete(`${BASE}/${tid}/favorite`);
            (0, cliHelpers_1.emit)(o.json, result, () => `✓ 模板 #${tid} ${name === 'favorite' ? '已收藏' : '已取消收藏'}，当前收藏数: ${result?.favoriteCount ?? '—'}`);
        }));
    }
}
function registerTemplateCommands(program) {
    const tpl = program
        .command('template')
        .description('Template Center — browse, create, version, publish, review and bundle templates');
    registerBrowse(tpl);
    registerManage(tpl);
    (0, versionCommands_1.registerVersionCommands)(tpl);
    (0, reviewCommands_1.registerReviewCommands)(tpl);
    (0, packageCommands_1.registerPackageCommands)(tpl);
    (0, adminCommands_1.registerAdminCommands)(tpl);
}
exports.registerTemplateCommands = registerTemplateCommands;
//# sourceMappingURL=index.js.map