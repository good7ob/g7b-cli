"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkspaceCommands = exports.MAX_QUEUE_LIMIT = void 0;
const aiTeamCommands_1 = require("./aiTeamCommands");
const queueCommands_1 = require("./queueCommands");
const viewCommands_1 = require("./viewCommands");
/**
 * Personal workspace. `queue` lists what is waiting on *me* (plan/completion approvals, approval
 * requests, info requests, blocked/paused tasks, alerts, requirements to triage, risks) and acts
 * on those items; `overview / tasks / products / orgs` are the "mine" views. Deliberately not
 * called "inbox": in this CLI that word is the requirement-inbox status (`good7ob req`).
 * Queue lives in queueCommands.ts, the other views in viewCommands.ts, the AI team / daily report /
 * next actions (B2) in aiTeamCommands.ts.
 */
var input_1 = require("./input");
Object.defineProperty(exports, "MAX_QUEUE_LIMIT", { enumerable: true, get: function () { return input_1.MAX_QUEUE_LIMIT; } });
function registerWorkspaceCommands(program) {
    const workspace = program.command('workspace').description('Personal workspace — what is waiting on me, my tasks / products / orgs, my AI team, daily report, next actions');
    (0, queueCommands_1.registerQueueCommands)(workspace);
    (0, viewCommands_1.registerViewCommands)(workspace);
    (0, aiTeamCommands_1.registerAiCommands)(workspace);
}
exports.registerWorkspaceCommands = registerWorkspaceCommands;
//# sourceMappingURL=index.js.map