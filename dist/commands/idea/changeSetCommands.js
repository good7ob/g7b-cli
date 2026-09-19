"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChangeSetCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const aiInput_1 = require("./aiInput");
const changeSetInput_1 = require("./changeSetInput");
const changeSetItemCommands_1 = require("./changeSetItemCommands");
const changeSetRender_1 = require("./changeSetRender");
/**
 * A2 change sets (forge/change-sets): turn an approved idea's chosen solution into a reviewed list of
 * impacted objects, get it approved, then Apply it into tasks + trace links. Apply never edits documents.
 * Items live in changeSetItemCommands.ts.
 */
const BASE = '/forge/change-sets';
const oneOf = (values) => values.join('|');
const CODES = { ...changeSetInput_1.CHANGE_SET_ERROR_CODES, ...aiInput_1.AI_ERROR_CODES };
const tag = (cs) => `${cs?.code ?? '-'} (#${cs?.id ?? '-'})`;
function registerChangeSetCommands(idea) {
    const cs = idea.command('change-set').description('Change sets — impact analysis, approval and Apply of an approved idea (A2)');
    cs
        .command('create <ideaId>')
        .description('Create a draft change set for an approved/planning idea (solution defaults to the selected one)')
        .requiredOption('--title <title>', 'Title (max 200 chars)')
        .option('--solution <id>', 'Solution being implemented (must belong to the idea)')
        .option('--summary <text>', 'Summary (max 2000 chars)')
        .option('--json', 'Output as JSON')
        .action(async (ideaId, o) => {
        try {
            const created = await ApiClient_1.default.post(BASE, (0, changeSetInput_1.buildCreateBody)((0, cliHelpers_1.parseId)(ideaId, 'ideaId'), o));
            (0, cliHelpers_1.emit)(o.json, created, () => `✓ 变更集已创建 (draft): ${tag(created)} ${created?.title ?? o.title}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('创建变更集失败', error, CODES);
        }
    });
    cs
        .command('list')
        .description('List change sets of an idea or a product, newest first')
        .option('--idea <id>', 'Idea id')
        .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID; not combinable with --idea)')
        .option('--status <status>', `Filter by status (${oneOf(changeSetInput_1.CHANGE_SET_STATUSES)})`)
        .option('-p, --page <num>', 'Page number', '1')
        .option('--page-size <num>', 'Items per page (1-100)', '20')
        .option('--json', 'Output as JSON')
        .action(async (o) => {
        try {
            const params = (0, changeSetInput_1.buildListParams)(o);
            const result = await ApiClient_1.default.get(BASE, params);
            (0, cliHelpers_1.emit)(o.json, result, () => (0, changeSetRender_1.renderChangeSetList)(result, Number(params.pageNum), Number(params.pageSize)));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取变更集列表失败', error, CODES);
        }
    });
    cs
        .command('get <id>')
        .description('Show a change set with its items')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const detail = await ApiClient_1.default.get(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}`);
            (0, cliHelpers_1.emit)(o.json, detail, () => (0, changeSetRender_1.renderChangeSetDetail)(detail));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取变更集失败', error, CODES);
        }
    });
    cs
        .command('update <id>')
        .description('Update title / summary (omitted flags stay unchanged; draft or impact_analyzed only)')
        .option('--title <title>', 'Title (max 200 chars)')
        .option('--summary <text>', 'Summary (max 2000 chars)')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const updated = await ApiClient_1.default.put(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}`, (0, changeSetInput_1.buildUpdateBody)(o));
            (0, cliHelpers_1.emit)(o.json, updated, () => `✓ 变更集已更新: ${tag(updated)}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('更新变更集失败', error, CODES);
        }
    });
    (0, changeSetItemCommands_1.registerChangeSetItemCommands)(cs, CODES);
    cs
        .command('analyze <id>')
        .description('Impact analysis: append trace-derived and AI-suggested items (unconfirmed); an AI failure degrades to trace-only with a warning')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const n = (0, cliHelpers_1.parseId)(id, 'id');
            const result = await ApiClient_1.default.post(`${BASE}/${n}/analyze`, undefined, { timeout: aiInput_1.AI_TIMEOUT_MS }).catch((e) => {
                throw (0, aiInput_1.withTimeoutHint)(e, `good7ob idea change-set get ${n}`);
            });
            (0, cliHelpers_1.emit)(o.json, result, () => (0, changeSetRender_1.renderAnalyze)(result));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('影响分析失败', error, CODES);
        }
    });
    cs
        .command('submit <id>')
        .description('Submit for approval (impact_analyzed with at least one confirmed item); org owners/admins approve')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const submitted = await ApiClient_1.default.post(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/submit`);
            (0, cliHelpers_1.emit)(o.json, submitted, () => `✓ 已提交审批: ${tag(submitted)} → ${submitted?.status ?? '-'}` +
                (submitted?.approvalId ? `，审批单 #${submitted.approvalId}（good7ob approval get ${submitted.approvalId}）` : ''));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('提交审批失败', error, CODES);
        }
    });
    cs
        .command('apply <id>')
        .description('Apply an approved change set: one task per confirmed item + trace links. Documents are NOT edited automatically')
        .option('--module <id>', 'Module for the tasks (must belong to the product; default: auto-created "Change <code>")')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const result = await ApiClient_1.default.post(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/apply`, (0, changeSetInput_1.buildApplyBody)(o));
            (0, cliHelpers_1.emit)(o.json, result, () => (0, changeSetRender_1.renderApply)(result));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('Apply 变更集失败', error, CODES);
        }
    });
    cs
        .command('cancel <id>')
        .description('Cancel (draft / impact_analyzed / approved; withdraw a pending approval first)')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const cancelled = await ApiClient_1.default.post(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/cancel`);
            (0, cliHelpers_1.emit)(o.json, cancelled, () => `✓ 变更集已取消: ${tag(cancelled)}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('取消变更集失败', error, CODES);
        }
    });
}
exports.registerChangeSetCommands = registerChangeSetCommands;
//# sourceMappingURL=changeSetCommands.js.map