"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIdeaCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const aiCommands_1 = require("./aiCommands");
const changeSetCommands_1 = require("./changeSetCommands");
const collabCommands_1 = require("./collabCommands");
const input_1 = require("./input");
const render_1 = require("./render");
const reviewCommands_1 = require("./reviewCommands");
const solutionCommands_1 = require("./solutionCommands");
/**
 * Idea pool commands (forge/ideas): capture an idea, attach candidate
 * solutions, then pick one — which approves the idea and drops a requirement
 * into the requirement inbox (see `good7ob req`). Solutions live in solutionCommands.ts,
 * restore/merge/comment/attachment/tag/relation in collabCommands.ts, and the A2 groups (generate/correction,
 * change-set, review) in aiCommands.ts / changeSetCommands.ts / reviewCommands.ts.
 *
 * Business errors come back as HTTP 200 + non-200 `code`; ApiClient throws on
 * those, and `fail` maps the idea error codes to readable messages.
 */
const BASE = '/forge/ideas';
const oneOf = (values) => values.join('|');
function renderSelectOutcome(id, sid, detail) {
    const decision = detail?.decision;
    if (decision?.approvalStatus === 'pending') {
        const approval = decision.approvalId ? `审批单 #${decision.approvalId}（good7ob approval get ${decision.approvalId}）` : '审批单已创建';
        return `✓ 已提交审批: 方案 #${sid} 待审批，Idea #${id} 仍为 evaluating，${approval}；批准后才会批准 Idea 并创建需求`;
    }
    const reqId = detail?.idea?.requirementId;
    return `✓ 已选定方案 #${sid}，Idea #${id} 已批准` +
        (reqId ? `，已在需求收件箱创建需求 #${reqId}（good7ob req show ${reqId}）` : '');
}
/** Add the shared idea field flags (create requires some of them; update none). */
function withIdeaFields(cmd) {
    return cmd
        .option('--description <text>', 'Description')
        .option('--priority <p>', `Priority (${oneOf(input_1.PRIORITIES)})`)
        .option('--expected-value <text>', 'Expected value (max 500 chars)');
}
function registerIdeaCommands(program) {
    const idea = program
        .command('idea')
        .description('Idea pool — capture, evaluate, compare solutions, approve into a requirement');
    idea
        .command('list')
        .description('List ideas of a product')
        .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID)')
        .option('--status <status>', `Filter by status (${oneOf(input_1.STATUSES)})`)
        .option('-k, --keyword <text>', 'Search title and description')
        .option('--tag <tag>', 'Only ideas carrying this tag (exact, case-insensitive)')
        .option('--release <id>', 'Only ideas linked to this release id')
        .option('-p, --page <num>', 'Page number', '1')
        .option('--page-size <num>', 'Items per page (1-100)', '20')
        .option('--json', 'Output as JSON')
        .action(async (o) => {
        try {
            const params = (0, input_1.buildListParams)(o);
            const result = await ApiClient_1.default.get(BASE, params);
            (0, cliHelpers_1.emit)(o.json, result, () => (0, render_1.renderIdeaList)(result, Number(params.pageNum), Number(params.pageSize)));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取 Idea 列表失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    idea
        .command('get <id>')
        .description('Show an idea with its solutions side by side')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const detail = await ApiClient_1.default.get(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}`);
            (0, cliHelpers_1.emit)(o.json, detail, () => (0, render_1.renderIdeaDetail)(detail));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取 Idea 详情失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    withIdeaFields(idea.command('create'))
        .description('Create an idea (always starts as draft)')
        .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID)')
        .requiredOption('--title <title>', 'Title (max 200 chars)')
        .requiredOption('--source <source>', `Source (${oneOf(input_1.SOURCES)})`)
        .option('--json', 'Output as JSON')
        .action(async (o) => {
        try {
            const created = await ApiClient_1.default.post(BASE, (0, input_1.buildCreateBody)(o));
            (0, cliHelpers_1.emit)(o.json, created, () => `✓ Idea 已创建 (draft): #${created?.id ?? '-'} ${created?.title ?? o.title}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('创建 Idea 失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    withIdeaFields(idea.command('update <id>'))
        .description('Update an idea (omitted flags stay unchanged; locked once approved/archived; only --release stays editable through developing)')
        .option('--title <title>', 'Title (max 200 chars)')
        .option('--source <source>', `Source (${oneOf(input_1.SOURCES)})`)
        .option('--release <id>', 'Link to a release of the same product (planned|in_progress|awaiting_approval)')
        .option('--clear-release', 'Unlink from its release')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const updated = await ApiClient_1.default.put(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}`, (0, input_1.buildUpdateBody)(o));
            (0, cliHelpers_1.emit)(o.json, updated, () => `✓ Idea 已更新: #${id}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('更新 Idea 失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    idea
        .command('delete <id>')
        .description('Delete an idea (soft delete)')
        .action(async (id) => {
        try {
            await ApiClient_1.default.delete(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}`);
            console.log(`✓ Idea 已删除: #${id}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('删除 Idea 失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    idea
        .command('status <id> <toStatus>')
        .description(`Move an idea to ${oneOf(input_1.TRANSITIONS)}`)
        .option('--json', 'Output as JSON')
        .action(async (id, toStatus, o) => {
        try {
            const target = (0, input_1.parseTransition)(toStatus);
            const moved = await ApiClient_1.default.post(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/status`, { toStatus: target });
            (0, cliHelpers_1.emit)(o.json, moved, () => `✓ Idea #${id} → ${target}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('变更 Idea 状态失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    idea
        .command('reject <id>')
        .description('Reject an evaluating idea')
        .requiredOption('--reason <text>', 'Rejection reason (max 1000 chars)')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const rejected = await ApiClient_1.default.post(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/reject`, (0, input_1.buildReasonBody)('reason', o.reason));
            (0, cliHelpers_1.emit)(o.json, rejected, () => `✓ Idea #${id} 已驳回 (rejected)`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('驳回 Idea 失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    (0, solutionCommands_1.registerSolutionCommands)(idea);
    (0, collabCommands_1.registerCollabCommands)(idea);
    (0, aiCommands_1.registerAiCommands)(idea);
    (0, changeSetCommands_1.registerChangeSetCommands)(idea);
    (0, reviewCommands_1.registerReviewCommands)(idea);
    idea
        .command('select <ideaId> <solutionId>')
        .description('Pick the winning solution: approves the idea and creates a requirement in the inbox (or files an approval with --require-approval)')
        .requiredOption('--reason <text>', 'Decision reason (max 1000 chars)')
        .option('--rejected-reason <solutionId:text>', 'Why another solution lost, repeatable (text max 1000 chars)', cliHelpers_1.collect)
        .option('--require-approval', 'Ask the org owner/admins to approve first; the idea stays evaluating until they do')
        .option('--json', 'Output as JSON')
        .action(async (ideaId, solutionId, o) => {
        try {
            const id = (0, cliHelpers_1.parseId)(ideaId, 'ideaId');
            const sid = (0, cliHelpers_1.parseId)(solutionId, 'solutionId');
            const body = (0, input_1.buildSelectBody)(sid, o);
            const detail = await ApiClient_1.default.post(`${BASE}/${id}/solutions/${sid}/select`, body);
            (0, cliHelpers_1.emit)(o.json, detail, () => renderSelectOutcome(id, sid, detail));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('选定方案失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
}
exports.registerIdeaCommands = registerIdeaCommands;
//# sourceMappingURL=index.js.map