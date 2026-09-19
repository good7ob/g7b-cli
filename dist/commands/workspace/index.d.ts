import { Command } from 'commander';
/**
 * Personal workspace. `queue` lists what is waiting on *me* (plan/completion
 * approvals, info requests, blocked/paused tasks, alerts, requirements to
 * triage). Deliberately not called "inbox": in this CLI that word is the
 * requirement-inbox status (`good7ob req`).
 */
export declare const MAX_QUEUE_LIMIT = 200;
export declare function registerWorkspaceCommands(program: Command): void;
//# sourceMappingURL=index.d.ts.map