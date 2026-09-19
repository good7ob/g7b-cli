import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, fail, parseId } from '../../utils/cliHelpers';
import {
  RELEASE_ERROR_CODES, STATUSES, buildCreateBody, buildListParams, buildRequestApprovalBody,
  buildTaskIdsBody, buildUpdateBody,
} from './input';
import { registerReleaseProgressCommands } from './progress';
import { Release, ReleaseTask, renderReleaseDetail, renderReleaseList, renderReleaseTasks } from './render';

/**
 * Release commands (/forge/releases): plan a release, attach tasks, then walk it through
 * planned -> in_progress -> awaiting_approval -> released. Approving/rejecting the release
 * is `good7ob approval approve|reject`, not done here.
 *
 * Business errors come back as HTTP 200 + non-200 `code`; ApiClient throws on those and
 * `fail` maps the release error codes to readable messages.
 */

const BASE = '/forge/releases';
const oneOf = (values: readonly string[]) => values.join('|');

/** POST /{id}/<action> commands that take no input beyond the id. */
function registerAction(
  release: Command, action: string, description: string, failPrefix: string,
  done: (id: number) => string,
): void {
  release
    .command(`${action} <id>`)
    .description(description)
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const rid = parseId(id, 'id');
        const moved: Release = await apiClient.post(`${BASE}/${rid}/${action}`);
        emit(o.json, moved, () => done(rid));
      } catch (error) {
        fail(failPrefix, error, RELEASE_ERROR_CODES);
      }
    });
}

function withReleaseFields(cmd: Command): Command {
  return cmd
    .option('--description <text>', 'Description')
    .option('--start <yyyy-MM-dd>', 'Planned start date')
    .option('--end <yyyy-MM-dd>', 'Planned end date (not before --start)');
}

// `tasks` and its subcommands all declare --json; commander hands a flag placed after the
// subcommand name to the parent that also knows it, so subcommands read the merged options.
function registerTaskCommands(release: Command): void {
  const tasks = release
    .command('tasks <id>')
    .description('List the tasks of a release (subcommands: add, remove)')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const list: ReleaseTask[] = (await apiClient.get(`${BASE}/${parseId(id, 'id')}/tasks`)) ?? [];
        emit(o.json, list, () => renderReleaseTasks(list));
      } catch (error) {
        fail('获取 Release 任务失败', error, RELEASE_ERROR_CODES);
      }
    });

  const change = (verb: 'add' | 'remove', description: string, done: string) =>
    tasks
      .command(`${verb} <id>`)
      .description(description)
      .requiredOption('--task-ids <ids>', 'Comma-separated task ids, 1-200 (e.g. 1,2,3)')
      .option('--json', 'Output as JSON')
      .action(async (id, _o, cmd: Command) => {
        try {
          const o = cmd.optsWithGlobals();
          const url = `${BASE}/${parseId(id, 'id')}/tasks`;
          const body = buildTaskIdsBody(o.taskIds);
          const updated: Release = verb === 'add' ? await apiClient.post(url, body) : await apiClient.delete(url, body);
          emit(o.json, updated, () => `✓ ${done} ${body.taskIds.length} 个任务，Release #${id} 现有 ${updated?.taskCount ?? '—'} 个任务`);
        } catch (error) {
          fail(verb === 'add' ? '关联任务失败' : '解除任务关联失败', error, RELEASE_ERROR_CODES);
        }
      });

  change('add', 'Attach tasks (idempotent; all-or-nothing; only while planned/in_progress)', '已关联');
  change('remove', 'Detach tasks (only those belonging to this release; only while planned/in_progress)', '已解除');
}

export function registerReleaseCommands(program: Command) {
  const release = program
    .command('release')
    .description('Releases — plan, attach tasks, start, request approval (approve via `approval`)');

  release
    .command('list')
    .description('List releases of a product, newest first (all of them, not paged)')
    .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID)')
    .option('--status <status>', `Filter by status (${oneOf(STATUSES)})`)
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const list: Release[] = (await apiClient.get(BASE, buildListParams(o))) ?? [];
        emit(o.json, list, () => renderReleaseList(list));
      } catch (error) {
        fail('获取 Release 列表失败', error, RELEASE_ERROR_CODES);
      }
    });

  release
    .command('get <id>')
    .description('Show a release, including its pending approval id')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const detail: Release = await apiClient.get(`${BASE}/${parseId(id, 'id')}`);
        emit(o.json, detail, () => renderReleaseDetail(detail ?? { id: Number(id) }));
      } catch (error) {
        fail('获取 Release 详情失败', error, RELEASE_ERROR_CODES);
      }
    });

  withReleaseFields(release.command('create'))
    .description('Create a release (always starts as planned; version is unique per product)')
    .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID)')
    .requiredOption('--name <name>', 'Name (max 200 chars)')
    .requiredOption('--version <version>', 'Version label (max 50 chars)')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const created: Release = await apiClient.post(BASE, buildCreateBody(o));
        emit(o.json, created, () => `✓ Release 已创建 (planned): #${created?.id ?? '-'} ${created?.version ?? o.version} ${created?.name ?? o.name}`);
      } catch (error) {
        fail('创建 Release 失败', error, RELEASE_ERROR_CODES);
      }
    });

  withReleaseFields(release.command('update <id>'))
    .description('Update a release (omitted flags stay unchanged; only planned/in_progress)')
    .option('--name <name>', 'Name (max 200 chars)')
    .option('--version <version>', 'Version label (max 50 chars)')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const rid = parseId(id, 'id');
        const updated: Release = await apiClient.put(`${BASE}/${rid}`, buildUpdateBody(o));
        emit(o.json, updated, () => `✓ Release 已更新: #${rid}`);
      } catch (error) {
        fail('更新 Release 失败', error, RELEASE_ERROR_CODES);
      }
    });

  release
    .command('delete <id>')
    .description('Delete a release (soft delete, detaches its tasks; only planned/cancelled)')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const rid = parseId(id, 'id');
        await apiClient.delete(`${BASE}/${rid}`);
        emit(o.json, { deleted: true, id: rid }, () => `✓ Release 已删除: #${rid}`);
      } catch (error) {
        fail('删除 Release 失败', error, RELEASE_ERROR_CODES);
      }
    });

  registerAction(release, 'start', 'Start a planned release (planned → in_progress)', '开始 Release 失败',
    (id) => `✓ Release #${id} 已开始 (in_progress)`);
  registerAction(release, 'cancel', 'Cancel a planned/in_progress release', '取消 Release 失败',
    (id) => `✓ Release #${id} 已取消 (cancelled)`);

  release
    .command('request-approval <id>')
    .description('Ask for release approval (in_progress → awaiting_approval, opens a RELEASE approval)')
    .option('--description <text>', 'Note for the approvers')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const rid = parseId(id, 'id');
        const moved: Release = await apiClient.post(`${BASE}/${rid}/request-approval`, buildRequestApprovalBody(o.description));
        emit(o.json, moved, () => `✓ Release #${rid} 已提交审批 (awaiting_approval)` +
          (moved?.pendingApprovalId ? `，审批 #${moved.pendingApprovalId}（good7ob approval get ${moved.pendingApprovalId}）` : ''));
      } catch (error) {
        fail('申请发布审批失败', error, RELEASE_ERROR_CODES);
      }
    });

  registerTaskCommands(release);
  registerReleaseProgressCommands(release);
}
