import { Command } from 'commander';
/**
 * Personal workspace. `queue` lists what is waiting on *me* (plan/completion approvals, approval
 * requests, info requests, blocked/paused tasks, alerts, requirements to triage, risks) and acts
 * on those items; `overview / tasks / products / orgs` are the "mine" views. Deliberately not
 * called "inbox": in this CLI that word is the requirement-inbox status (`good7ob req`).
 * Queue lives in queueCommands.ts, the other views in viewCommands.ts.
 */
export { MAX_QUEUE_LIMIT } from './input';
export declare function registerWorkspaceCommands(program: Command): void;
//# sourceMappingURL=index.d.ts.map