"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCollabCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const collabInput_1 = require("./collabInput");
const input_1 = require("./input");
const renderCollab_1 = require("./renderCollab");
/**
 * Idea collaboration commands (forge/ideas/{id}/...): restore, merge, duplicates, comment,
 * attachment, tag, relation. Every one needs the caller to be an active member of the org that
 * owns the idea's product (2000 otherwise).
 */
const BASE = '/forge/ideas';
function registerRestoreMergeDuplicates(idea) {
    idea
        .command('restore <id>')
        .description('Restore a soft-deleted idea, or an archived one (back to draft) that never produced a requirement')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const restored = await ApiClient_1.default.post(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/restore`);
            (0, cliHelpers_1.emit)(o.json, restored, () => `✓ Idea #${id} 已恢复 (${restored?.status ?? '—'})`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('恢复 Idea 失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    idea
        .command('merge <id>')
        .description('Merge this (source) idea into --into: moves solutions/comments/attachments/tags, archives the source')
        .requiredOption('--into <targetId>', 'Target idea id (same product; both must be draft/evaluating, no pending decision)')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const sid = (0, cliHelpers_1.parseId)(id, 'id');
            const body = (0, collabInput_1.buildMergeBody)(sid, o.into);
            const result = await ApiClient_1.default.post(`${BASE}/${sid}/merge`, body);
            (0, cliHelpers_1.emit)(o.json, result, () => (0, renderCollab_1.renderMerge)(sid, body.targetIdeaId, result));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('合并 Idea 失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    idea
        .command('duplicates <id>')
        .description('List ideas of the same product with a similar title')
        .option('--limit <n>', 'Max candidates (1-20, default 5)')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const params = (0, collabInput_1.buildDuplicatesParams)(o.limit);
            const list = (await ApiClient_1.default.get(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/duplicates`, params)) ?? [];
            (0, cliHelpers_1.emit)(o.json, list, () => (0, renderCollab_1.renderDuplicates)(list));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('查找疑似重复 Idea 失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
}
function registerCommentCommands(idea) {
    const comment = idea.command('comment').description('Comments on an idea');
    comment
        .command('add <id>')
        .description('Post a comment (or a reply with --parent)')
        .requiredOption('--text <text>', 'Comment text (max 2000 chars)')
        .option('--parent <commentId>', 'Reply to this comment of the same idea')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const created = await ApiClient_1.default.post(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/comments`, (0, collabInput_1.buildCommentBody)(o));
            (0, cliHelpers_1.emit)(o.json, created, () => `✓ 评论已添加: #${created?.id ?? '-'}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('添加评论失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    comment
        .command('list <id>')
        .description('List comments, oldest first')
        .option('-p, --page <num>', 'Page number', '1')
        .option('--page-size <num>', 'Items per page (1-100)', '20')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const params = (0, collabInput_1.buildCommentListParams)(o);
            const result = await ApiClient_1.default.get(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/comments`, params);
            (0, cliHelpers_1.emit)(o.json, result, () => (0, renderCollab_1.renderComments)(result, params.pageNum, params.pageSize));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取评论失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    comment
        .command('delete <id> <commentId>')
        .description('Delete a comment (its author, or an org owner/admin)')
        .action(async (id, commentId) => {
        try {
            await ApiClient_1.default.delete(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/comments/${(0, cliHelpers_1.parseId)(commentId, 'commentId')}`);
            console.log(`✓ 评论已删除: #${commentId}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('删除评论失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
}
function registerAttachmentCommands(idea) {
    const attachment = idea.command('attachment').description('Attachments of an idea (metadata of files already uploaded to project storage)');
    attachment
        .command('add <id>')
        .description('Register an uploaded file (upload it first via POST /file/upload2s3, then pass the returned fileUrl)')
        .requiredOption('--name <name>', 'File name (max 255 chars)')
        .requiredOption('--url <url>', 'https URL of the object under /public/ of the project S3 bucket, no query string')
        .requiredOption('--size <bytes>', 'File size in bytes (0-20971520)')
        .option('--content-type <mime>', 'Content type (max 100 chars)')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const created = await ApiClient_1.default.post(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/attachments`, (0, collabInput_1.buildAttachmentBody)(o));
            (0, cliHelpers_1.emit)(o.json, created, () => `✓ 附件已登记: #${created?.id ?? '-'} ${o.name}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('登记附件失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    attachment
        .command('list <id>')
        .description('List attachments')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const list = (await ApiClient_1.default.get(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/attachments`)) ?? [];
            (0, cliHelpers_1.emit)(o.json, list, () => (0, renderCollab_1.renderAttachments)(list));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取附件失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    attachment
        .command('delete <id> <attachmentId>')
        .description('Unregister an attachment (the S3 object stays; registrant or org owner/admin)')
        .action(async (id, attachmentId) => {
        try {
            await ApiClient_1.default.delete(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/attachments/${(0, cliHelpers_1.parseId)(attachmentId, 'attachmentId')}`);
            console.log(`✓ 附件已删除: #${attachmentId}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('删除附件失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
}
function registerTagAndRelationCommands(idea) {
    idea
        .command('tag')
        .description('Tags of an idea')
        .command('set <id>')
        .description('Replace the whole tag set (max 10, each 1-30 chars; trimmed, lower-cased, de-duplicated)')
        .requiredOption('--tags <a,b,c>', 'Comma-separated tags; "" clears them')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const body = (0, collabInput_1.buildTagsBody)(o.tags);
            const saved = await ApiClient_1.default.put(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/tags`, body);
            (0, cliHelpers_1.emit)(o.json, saved, () => `✓ Idea #${id} 标签: ${(saved ?? body.tags).join(', ') || '—'}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('设置标签失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    const relation = idea.command('relation').description('Relations between ideas of the same product');
    relation
        .command('add <id>')
        .description('Create <id> --type--> --to')
        .requiredOption('--to <ideaId>', 'The other idea (same product, not itself)')
        .requiredOption('--type <type>', `Relation type (${collabInput_1.RELATION_TYPES.join('|')})`)
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const sid = (0, cliHelpers_1.parseId)(id, 'id');
            const body = (0, collabInput_1.buildRelationBody)(sid, o);
            const created = await ApiClient_1.default.post(`${BASE}/${sid}/relations`, body);
            (0, cliHelpers_1.emit)(o.json, created, () => `✓ 关联已创建: #${created?.id ?? '-'}  #${sid} —${body.relationType}→ #${body.relatedIdeaId}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('创建关联失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    relation
        .command('list <id>')
        .description('List relations in both directions')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const list = (await ApiClient_1.default.get(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/relations`)) ?? [];
            (0, cliHelpers_1.emit)(o.json, list, () => (0, renderCollab_1.renderRelations)(list));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取关联失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    relation
        .command('remove <id> <relationId>')
        .description('Remove a relation (a member of either idea may)')
        .action(async (id, relationId) => {
        try {
            await ApiClient_1.default.delete(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/relations/${(0, cliHelpers_1.parseId)(relationId, 'relationId')}`);
            console.log(`✓ 关联已删除: #${relationId}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('删除关联失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
}
function registerCollabCommands(idea) {
    registerRestoreMergeDuplicates(idea);
    registerCommentCommands(idea);
    registerAttachmentCommands(idea);
    registerTagAndRelationCommands(idea);
}
exports.registerCollabCommands = registerCollabCommands;
//# sourceMappingURL=collabCommands.js.map