import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { emit, guarded } from '../../../utils/cliHelpers';
import { ACTIVITY_ERROR_CODES, ACTOR_TYPES, MAX_LIMIT, MAX_PAGE_SIZE, MAX_SUMMARY, POST_TYPES, buildListTarget, buildPostBody } from './input';
import { Activity, ActivityPage, renderActivityList } from './render';

/**
 * Task / project activity feed (prd-0092 FP-6, api-0092): `pm activity` lists, `pm activity post`
 * writes a manual NOTE / REPORT_UPLOADED entry. `activity` is a command with a subcommand, and commander
 * lets an ancestor consume a flag it knows wherever it appears (`post --task 5` is read by `activity`),
 * so both actions read their options through `cmd.optsWithGlobals()` — no defaults on the parent flags.
 */

export function registerActivityCommands(pmCommand: Command) {
  const activity = pmCommand
    .command('activity')
    .description('Task / project activity feed (newest first); subcommand: post')
    .allowExcessArguments(false)
    .option('--project <id>', 'Project activities (mutually exclusive with --task)')
    .option('--task <id>', 'Task activities (mutually exclusive with --project)')
    .option('--since <id>', 'Cursor mode: only activities with id > this (0 = from the start); pairs with --limit')
    .option('--type <a,b>', 'Only these activity types, comma-separated (project only, e.g. HANDOFF,NOTE)')
    .option('--actor <type>', `Only this actor type (${ACTOR_TYPES.join('|')}; project only)`)
    .option('--limit <n>', `Cursor mode page length (1-${MAX_LIMIT}, default 50)`)
    .option('-p, --page <n>', 'Page number (page mode, default 1)')
    .option('--page-size <n>', `Items per page (page mode, 1-${MAX_PAGE_SIZE}, default 20)`)
    .option('--json', 'Output as JSON')
    .action((_o, cmd: Command) =>
      guarded('获取动态失败', ACTIVITY_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const { url, params } = buildListTarget(o);
        const page: ActivityPage = await apiClient.get(url, params);
        emit(o.json, page, () => renderActivityList(page ?? {}));
      }));

  activity
    .command('post')
    .description(`Write a manual activity on a task (${POST_TYPES.join('|')}; --project/--since/--actor belong to the list, not to post)`)
    .option('--task <id>', 'Task id (required)')
    .option('--summary <text>', `What happened (required, ≤${MAX_SUMMARY} chars)`)
    .option('--type <type>', `Activity type (${POST_TYPES.join('|')}, default NOTE)`)
    .option('--url <https-url>', 'Link stored in metadata.url (https:// only)')
    .option('--json', 'Output as JSON')
    .action((_o, cmd: Command) =>
      guarded('写入动态失败', ACTIVITY_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const { taskId, body } = buildPostBody(o);
        const created: Activity = await apiClient.post(`/progress/tasks/${taskId}/activities`, body);
        emit(o.json, created, () => `✓ 动态已写入: #${created?.id ?? '-'} ${body.type} 任务 #${taskId} — ${body.summary}`);
      }));
}
