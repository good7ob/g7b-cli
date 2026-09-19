import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, fail, parseId } from '../../utils/cliHelpers';
import {
  RELATION_TYPES, buildAttachmentBody, buildCommentBody, buildCommentListParams, buildDuplicatesParams,
  buildMergeBody, buildRelationBody, buildTagsBody,
} from './collabInput';
import { IDEA_ERROR_CODES } from './input';
import {
  DuplicateCandidate, IdeaAttachment, IdeaRelation, MergeResult,
  renderAttachments, renderComments, renderDuplicates, renderMerge, renderRelations,
} from './renderCollab';

/**
 * Idea collaboration commands (forge/ideas/{id}/...): restore, merge, duplicates, comment,
 * attachment, tag, relation. Every one needs the caller to be an active member of the org that
 * owns the idea's product (2000 otherwise).
 */

const BASE = '/forge/ideas';

function registerRestoreMergeDuplicates(idea: Command): void {
  idea
    .command('restore <id>')
    .description('Restore a soft-deleted idea, or an archived one (back to draft) that never produced a requirement')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const restored = await apiClient.post(`${BASE}/${parseId(id, 'id')}/restore`);
        emit(o.json, restored, () => `✓ Idea #${id} 已恢复 (${restored?.status ?? '—'})`);
      } catch (error) {
        fail('恢复 Idea 失败', error, IDEA_ERROR_CODES);
      }
    });

  idea
    .command('merge <id>')
    .description('Merge this (source) idea into --into: moves solutions/comments/attachments/tags, archives the source')
    .requiredOption('--into <targetId>', 'Target idea id (same product; both must be draft/evaluating, no pending decision)')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const sid = parseId(id, 'id');
        const body = buildMergeBody(sid, o.into);
        const result: MergeResult = await apiClient.post(`${BASE}/${sid}/merge`, body);
        emit(o.json, result, () => renderMerge(sid, body.targetIdeaId, result));
      } catch (error) {
        fail('合并 Idea 失败', error, IDEA_ERROR_CODES);
      }
    });

  idea
    .command('duplicates <id>')
    .description('List ideas of the same product with a similar title')
    .option('--limit <n>', 'Max candidates (1-20, default 5)')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const params = buildDuplicatesParams(o.limit);
        const list: DuplicateCandidate[] = (await apiClient.get(`${BASE}/${parseId(id, 'id')}/duplicates`, params)) ?? [];
        emit(o.json, list, () => renderDuplicates(list));
      } catch (error) {
        fail('查找疑似重复 Idea 失败', error, IDEA_ERROR_CODES);
      }
    });
}

function registerCommentCommands(idea: Command): void {
  const comment = idea.command('comment').description('Comments on an idea');

  comment
    .command('add <id>')
    .description('Post a comment (or a reply with --parent)')
    .requiredOption('--text <text>', 'Comment text (max 2000 chars)')
    .option('--parent <commentId>', 'Reply to this comment of the same idea')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const created = await apiClient.post(`${BASE}/${parseId(id, 'id')}/comments`, buildCommentBody(o));
        emit(o.json, created, () => `✓ 评论已添加: #${created?.id ?? '-'}`);
      } catch (error) {
        fail('添加评论失败', error, IDEA_ERROR_CODES);
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
        const params = buildCommentListParams(o);
        const result = await apiClient.get(`${BASE}/${parseId(id, 'id')}/comments`, params);
        emit(o.json, result, () => renderComments(result, params.pageNum, params.pageSize));
      } catch (error) {
        fail('获取评论失败', error, IDEA_ERROR_CODES);
      }
    });

  comment
    .command('delete <id> <commentId>')
    .description('Delete a comment (its author, or an org owner/admin)')
    .action(async (id, commentId) => {
      try {
        await apiClient.delete(`${BASE}/${parseId(id, 'id')}/comments/${parseId(commentId, 'commentId')}`);
        console.log(`✓ 评论已删除: #${commentId}`);
      } catch (error) {
        fail('删除评论失败', error, IDEA_ERROR_CODES);
      }
    });
}

function registerAttachmentCommands(idea: Command): void {
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
        const created = await apiClient.post(`${BASE}/${parseId(id, 'id')}/attachments`, buildAttachmentBody(o));
        emit(o.json, created, () => `✓ 附件已登记: #${created?.id ?? '-'} ${o.name}`);
      } catch (error) {
        fail('登记附件失败', error, IDEA_ERROR_CODES);
      }
    });

  attachment
    .command('list <id>')
    .description('List attachments')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const list: IdeaAttachment[] = (await apiClient.get(`${BASE}/${parseId(id, 'id')}/attachments`)) ?? [];
        emit(o.json, list, () => renderAttachments(list));
      } catch (error) {
        fail('获取附件失败', error, IDEA_ERROR_CODES);
      }
    });

  attachment
    .command('delete <id> <attachmentId>')
    .description('Unregister an attachment (the S3 object stays; registrant or org owner/admin)')
    .action(async (id, attachmentId) => {
      try {
        await apiClient.delete(`${BASE}/${parseId(id, 'id')}/attachments/${parseId(attachmentId, 'attachmentId')}`);
        console.log(`✓ 附件已删除: #${attachmentId}`);
      } catch (error) {
        fail('删除附件失败', error, IDEA_ERROR_CODES);
      }
    });
}

function registerTagAndRelationCommands(idea: Command): void {
  idea
    .command('tag')
    .description('Tags of an idea')
    .command('set <id>')
    .description('Replace the whole tag set (max 10, each 1-30 chars; trimmed, lower-cased, de-duplicated)')
    .requiredOption('--tags <a,b,c>', 'Comma-separated tags; "" clears them')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const body = buildTagsBody(o.tags);
        const saved: string[] | null = await apiClient.put(`${BASE}/${parseId(id, 'id')}/tags`, body);
        emit(o.json, saved, () => `✓ Idea #${id} 标签: ${(saved ?? body.tags).join(', ') || '—'}`);
      } catch (error) {
        fail('设置标签失败', error, IDEA_ERROR_CODES);
      }
    });

  const relation = idea.command('relation').description('Relations between ideas of the same product');

  relation
    .command('add <id>')
    .description('Create <id> --type--> --to')
    .requiredOption('--to <ideaId>', 'The other idea (same product, not itself)')
    .requiredOption('--type <type>', `Relation type (${RELATION_TYPES.join('|')})`)
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const sid = parseId(id, 'id');
        const body = buildRelationBody(sid, o);
        const created = await apiClient.post(`${BASE}/${sid}/relations`, body);
        emit(o.json, created, () => `✓ 关联已创建: #${created?.id ?? '-'}  #${sid} —${body.relationType}→ #${body.relatedIdeaId}`);
      } catch (error) {
        fail('创建关联失败', error, IDEA_ERROR_CODES);
      }
    });

  relation
    .command('list <id>')
    .description('List relations in both directions')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const list: IdeaRelation[] = (await apiClient.get(`${BASE}/${parseId(id, 'id')}/relations`)) ?? [];
        emit(o.json, list, () => renderRelations(list));
      } catch (error) {
        fail('获取关联失败', error, IDEA_ERROR_CODES);
      }
    });

  relation
    .command('remove <id> <relationId>')
    .description('Remove a relation (a member of either idea may)')
    .action(async (id, relationId) => {
      try {
        await apiClient.delete(`${BASE}/${parseId(id, 'id')}/relations/${parseId(relationId, 'relationId')}`);
        console.log(`✓ 关联已删除: #${relationId}`);
      } catch (error) {
        fail('删除关联失败', error, IDEA_ERROR_CODES);
      }
    });
}

export function registerCollabCommands(idea: Command): void {
  registerRestoreMergeDuplicates(idea);
  registerCommentCommands(idea);
  registerAttachmentCommands(idea);
  registerTagAndRelationCommands(idea);
}
