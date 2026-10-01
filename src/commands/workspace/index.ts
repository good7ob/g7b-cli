import { Command } from 'commander';
import { registerAiCommands } from './aiTeamCommands';
import { registerQueueCommands } from './queueCommands';
import { registerViewCommands } from './viewCommands';

/**
 * Personal workspace. `queue` lists what is waiting on *me* (plan/completion approvals, approval
 * requests, info requests, blocked/paused tasks, alerts, risks) and acts
 * on those items; `overview / tasks / products / orgs` are the "mine" views.
 * Queue lives in queueCommands.ts, the other views in viewCommands.ts, the AI team / daily report /
 * next actions (B2) in aiTeamCommands.ts.
 */

export { MAX_QUEUE_LIMIT } from './input';

export function registerWorkspaceCommands(program: Command) {
  const workspace = program.command('workspace').description('Personal workspace — what is waiting on me, my tasks / products / orgs, my AI team, daily report, next actions');
  registerQueueCommands(workspace);
  registerViewCommands(workspace);
  registerAiCommands(workspace);
}
