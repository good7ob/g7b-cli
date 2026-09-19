"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkspaceCommands = exports.MAX_QUEUE_LIMIT = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const render_1 = require("./render");
/**
 * Personal workspace. `queue` lists what is waiting on *me* (plan/completion
 * approvals, info requests, blocked/paused tasks, alerts, requirements to
 * triage). Deliberately not called "inbox": in this CLI that word is the
 * requirement-inbox status (`good7ob req`).
 */
exports.MAX_QUEUE_LIMIT = 200;
function registerWorkspaceCommands(program) {
    const workspace = program.command('workspace').description('Personal workspace — what is waiting on me');
    workspace
        .command('queue')
        .description('List items awaiting me, newest first (counts cover everything, the table is capped by --limit)')
        .option('-l, --limit <num>', `Max items to list (1-${exports.MAX_QUEUE_LIMIT})`, '50')
        .option('--json', 'Output as JSON')
        .action(async (o) => {
        try {
            const limit = (0, cliHelpers_1.parseIntInRange)(o.limit, '--limit', 1, exports.MAX_QUEUE_LIMIT);
            const queue = await ApiClient_1.default.get('/workspace/my-queue', { limit });
            console.log(o.json ? JSON.stringify(queue, null, 2) : (0, render_1.renderQueue)(queue ?? {}));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取我的待办队列失败', error, { 400: '缺少用户身份（userId），请先运行 good7ob config set api-key <key>' });
        }
    });
}
exports.registerWorkspaceCommands = registerWorkspaceCommands;
//# sourceMappingURL=index.js.map