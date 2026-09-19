import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, fail, parseId } from '../../utils/cliHelpers';
import { AI_ERROR_CODES, AI_TIMEOUT_MS, withTimeoutHint } from './aiInput';
import {
  CHANGE_SET_ERROR_CODES, CHANGE_SET_STATUSES, buildApplyBody, buildCreateBody, buildListParams, buildUpdateBody,
} from './changeSetInput';
import { registerChangeSetItemCommands } from './changeSetItemCommands';
import {
  AnalyzeResult, ApplyResult, ChangeSet, ChangeSetDetail,
  renderAnalyze, renderApply, renderChangeSetDetail, renderChangeSetList,
} from './changeSetRender';

/**
 * A2 change sets (forge/change-sets): turn an approved idea's chosen solution into a reviewed list of
 * impacted objects, get it approved, then Apply it into tasks + trace links. Apply never edits documents.
 * Items live in changeSetItemCommands.ts.
 */

const BASE = '/forge/change-sets';
const oneOf = (values: readonly string[]) => values.join('|');
const CODES = { ...CHANGE_SET_ERROR_CODES, ...AI_ERROR_CODES };
const tag = (cs: ChangeSet) => `${cs?.code ?? '-'} (#${cs?.id ?? '-'})`;

export function registerChangeSetCommands(idea: Command): void {
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
        const created: ChangeSet = await apiClient.post(BASE, buildCreateBody(parseId(ideaId, 'ideaId'), o));
        emit(o.json, created, () => `✓ 变更集已创建 (draft): ${tag(created)} ${created?.title ?? o.title}`);
      } catch (error) {
        fail('创建变更集失败', error, CODES);
      }
    });

  cs
    .command('list')
    .description('List change sets of an idea or a product, newest first')
    .option('--idea <id>', 'Idea id')
    .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID; not combinable with --idea)')
    .option('--status <status>', `Filter by status (${oneOf(CHANGE_SET_STATUSES)})`)
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-100)', '20')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const params = buildListParams(o);
        const result = await apiClient.get(BASE, params);
        emit(o.json, result, () => renderChangeSetList(result, Number(params.pageNum), Number(params.pageSize)));
      } catch (error) {
        fail('获取变更集列表失败', error, CODES);
      }
    });

  cs
    .command('get <id>')
    .description('Show a change set with its items')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const detail: ChangeSetDetail = await apiClient.get(`${BASE}/${parseId(id, 'id')}`);
        emit(o.json, detail, () => renderChangeSetDetail(detail));
      } catch (error) {
        fail('获取变更集失败', error, CODES);
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
        const updated = await apiClient.put(`${BASE}/${parseId(id, 'id')}`, buildUpdateBody(o));
        emit(o.json, updated, () => `✓ 变更集已更新: ${tag(updated)}`);
      } catch (error) {
        fail('更新变更集失败', error, CODES);
      }
    });

  registerChangeSetItemCommands(cs, CODES);

  cs
    .command('analyze <id>')
    .description('Impact analysis: append trace-derived and AI-suggested items (unconfirmed); an AI failure degrades to trace-only with a warning')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const n = parseId(id, 'id');
        const result: AnalyzeResult = await apiClient.post(`${BASE}/${n}/analyze`, undefined, { timeout: AI_TIMEOUT_MS }).catch((e: unknown) => {
          throw withTimeoutHint(e, `good7ob idea change-set get ${n}`);
        });
        emit(o.json, result, () => renderAnalyze(result));
      } catch (error) {
        fail('影响分析失败', error, CODES);
      }
    });

  cs
    .command('submit <id>')
    .description('Submit for approval (impact_analyzed with at least one confirmed item); org owners/admins approve')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const submitted: ChangeSet = await apiClient.post(`${BASE}/${parseId(id, 'id')}/submit`);
        emit(o.json, submitted, () => `✓ 已提交审批: ${tag(submitted)} → ${submitted?.status ?? '-'}` +
          (submitted?.approvalId ? `，审批单 #${submitted.approvalId}（good7ob approval get ${submitted.approvalId}）` : ''));
      } catch (error) {
        fail('提交审批失败', error, CODES);
      }
    });

  cs
    .command('apply <id>')
    .description('Apply an approved change set: one task per confirmed item + trace links. Documents are NOT edited automatically')
    .option('--module <id>', 'Module for the tasks (must belong to the product; default: auto-created "Change <code>")')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const result: ApplyResult = await apiClient.post(`${BASE}/${parseId(id, 'id')}/apply`, buildApplyBody(o));
        emit(o.json, result, () => renderApply(result));
      } catch (error) {
        fail('Apply 变更集失败', error, CODES);
      }
    });

  cs
    .command('cancel <id>')
    .description('Cancel (draft / impact_analyzed / approved; withdraw a pending approval first)')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const cancelled: ChangeSet = await apiClient.post(`${BASE}/${parseId(id, 'id')}/cancel`);
        emit(o.json, cancelled, () => `✓ 变更集已取消: ${tag(cancelled)}`);
      } catch (error) {
        fail('取消变更集失败', error, CODES);
      }
    });
}
