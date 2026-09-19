import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { fail, parseIntInRange } from '../../utils/cliHelpers';
import { MyQueue, renderQueue } from './render';

/**
 * Personal workspace. `queue` lists what is waiting on *me* (plan/completion
 * approvals, info requests, blocked/paused tasks, alerts, requirements to
 * triage). Deliberately not called "inbox": in this CLI that word is the
 * requirement-inbox status (`good7ob req`).
 */

export const MAX_QUEUE_LIMIT = 200;

export function registerWorkspaceCommands(program: Command) {
  const workspace = program.command('workspace').description('Personal workspace — what is waiting on me');

  workspace
    .command('queue')
    .description('List items awaiting me, newest first (counts cover everything, the table is capped by --limit)')
    .option('-l, --limit <num>', `Max items to list (1-${MAX_QUEUE_LIMIT})`, '50')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const limit = parseIntInRange(o.limit, '--limit', 1, MAX_QUEUE_LIMIT);
        const queue: MyQueue = await apiClient.get('/workspace/my-queue', { limit });
        console.log(o.json ? JSON.stringify(queue, null, 2) : renderQueue(queue ?? {}));
      } catch (error) {
        fail('获取我的待办队列失败', error, { 400: '缺少用户身份（userId），请先运行 good7ob config set api-key <key>' });
      }
    });
}
