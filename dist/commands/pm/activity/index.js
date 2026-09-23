"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerActivityCommands = void 0;
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
const cliHelpers_1 = require("../../../utils/cliHelpers");
const input_1 = require("./input");
const render_1 = require("./render");
/**
 * Task / project activity feed (prd-0092 FP-6, api-0092): `pm activity` lists, `pm activity post`
 * writes a manual NOTE / REPORT_UPLOADED entry. `activity` is a command with a subcommand, and commander
 * lets an ancestor consume a flag it knows wherever it appears (`post --task 5` is read by `activity`),
 * so both actions read their options through `cmd.optsWithGlobals()` — no defaults on the parent flags.
 */
function registerActivityCommands(pmCommand) {
    const activity = pmCommand
        .command('activity')
        .description('Task / project activity feed (newest first); subcommand: post')
        .allowExcessArguments(false)
        .option('--project <id>', 'Project activities (mutually exclusive with --task)')
        .option('--task <id>', 'Task activities (mutually exclusive with --project)')
        .option('--since <id>', 'Cursor mode: only activities with id > this (0 = from the start); pairs with --limit')
        .option('--type <a,b>', 'Only these activity types, comma-separated (project only, e.g. HANDOFF,NOTE)')
        .option('--actor <type>', `Only this actor type (${input_1.ACTOR_TYPES.join('|')}; project only)`)
        .option('--limit <n>', `Cursor mode page length (1-${input_1.MAX_LIMIT}, default 50)`)
        .option('-p, --page <n>', 'Page number (page mode, default 1)')
        .option('--page-size <n>', `Items per page (page mode, 1-${input_1.MAX_PAGE_SIZE}, default 20)`)
        .option('--json', 'Output as JSON')
        .action((_o, cmd) => (0, cliHelpers_1.guarded)('获取动态失败', input_1.ACTIVITY_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const { url, params } = (0, input_1.buildListTarget)(o);
        const page = await ApiClient_1.default.get(url, params);
        (0, cliHelpers_1.emit)(o.json, page, () => (0, render_1.renderActivityList)(page ?? {}));
    }));
    activity
        .command('post')
        .description(`Write a manual activity on a task (${input_1.POST_TYPES.join('|')}; --project/--since/--actor belong to the list, not to post)`)
        .option('--task <id>', 'Task id (required)')
        .option('--summary <text>', `What happened (required, ≤${input_1.MAX_SUMMARY} chars)`)
        .option('--type <type>', `Activity type (${input_1.POST_TYPES.join('|')}, default NOTE)`)
        .option('--url <https-url>', 'Link stored in metadata.url (https:// only)')
        .option('--json', 'Output as JSON')
        .action((_o, cmd) => (0, cliHelpers_1.guarded)('写入动态失败', input_1.ACTIVITY_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const { taskId, body } = (0, input_1.buildPostBody)(o);
        const created = await ApiClient_1.default.post(`/progress/tasks/${taskId}/activities`, body);
        (0, cliHelpers_1.emit)(o.json, created, () => `✓ 动态已写入: #${created?.id ?? '-'} ${body.type} 任务 #${taskId} — ${body.summary}`);
    }));
}
exports.registerActivityCommands = registerActivityCommands;
//# sourceMappingURL=index.js.map