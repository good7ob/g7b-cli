import { Command } from 'commander';
import * as path from 'path';
import { execFileSync } from 'child_process';
import worktreeState from '../../services/WorktreeStateService';
import { emit, fail, parseId } from '../../utils/cliHelpers';
import { renderWorktreeList } from './render';

function detectBranch(worktreePath: string): string | null {
  try {
    const branch = execFileSync('git', ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return branch || null;
  } catch {
    return null;
  }
}

/**
 * Local worktree-claim registry (see WorktreeStateService). Not a backend resource — this is
 * per-machine coordination between local agents, so there is no `--product` / API call here.
 */
export function registerWorktreeCommands(program: Command) {
  const wt = program
    .command('worktree')
    .description("Track which task owns which local git worktree, so this machine's agents don't edit the same working copy");

  wt.command('claim')
    .description('Claim a worktree for a task; fails if another active task already holds it')
    .requiredOption('--task <id>', 'Task id')
    .option('--path <path>', 'Worktree path', process.cwd())
    .option('--branch <name>', 'Branch checked out there (default: detected via git)')
    .option('--pid <pid>', 'Owning process id (default: parent process, i.e. the agent shell)', String(process.ppid))
    .option('--summary <text>', 'Free-text note, e.g. what the task is doing')
    .option('--force', 'Steal the claim even if another active task holds it', false)
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const taskId = String(parseId(o.task, '--task'));
        // a non-numeric pid used to be stored as NaN -> null, i.e. a claim that is "dead" the moment it is written
        const pid = parseId(o.pid, '--pid');
        const worktreePath = path.resolve(o.path);
        const entry = await worktreeState.claim({
          taskId,
          worktreePath,
          branch: o.branch ?? detectBranch(worktreePath),
          pid,
          summary: o.summary ?? null,
          force: !!o.force,
        });
        emit(o.json, entry, () => `✓ 任务 #${entry.taskId} 已占用 worktree: ${entry.worktreePath}${entry.branch ? ` (${entry.branch})` : ''}`);
      } catch (error) {
        fail('占用 worktree 失败', error);
      }
    });

  wt.command('heartbeat')
    .description('Refresh the heartbeat for a claimed task (call periodically from long-running agents)')
    .requiredOption('--task <id>', 'Task id')
    .option('--pid <pid>', 'Update the owning process id too')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const taskId = String(parseId(o.task, '--task'));
        const entry = await worktreeState.heartbeat(taskId, o.pid === undefined ? undefined : parseId(o.pid, '--pid'));
        emit(o.json, entry, () => `✓ 任务 #${entry.taskId} 心跳已更新`);
      } catch (error) {
        fail('更新心跳失败', error);
      }
    });

  wt.command('release')
    .description("Release a task's worktree claim")
    .requiredOption('--task <id>', 'Task id')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const taskId = String(parseId(o.task, '--task'));
        const released = await worktreeState.release(taskId);
        emit(o.json, { released, taskId }, () =>
          released ? `✓ 任务 #${taskId} 的 worktree 占用已释放` : `任务 #${taskId} 没有占用记录`);
      } catch (error) {
        fail('释放 worktree 失败', error);
      }
    });

  wt.command('list')
    .description('List worktree claims (stale entries — dead pid or silent too long — are pruned first)')
    .option('--all', 'Include stale entries instead of pruning them', false)
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const entries = o.all ? worktreeState.list() : await worktreeState.prune();
        emit(o.json, entries, () => renderWorktreeList(entries));
      } catch (error) {
        fail('读取 worktree 列表失败', error);
      }
    });
}
