"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerQueueCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("./input");
const render_1 = require("./render");
/**
 * `workspace queue` (the persisted "awaiting me" queue) and its item commands. `queue` itself
 * lists; the subcommands act on one item by its queue-item id (the ID column of the list, not
 * the source object's id). Business errors come back as HTTP 200 + non-200 `code`; ApiClient
 * throws on those and `fail` maps the codes.
 */
const BASE = '/workspace/my-queue';
/**
 * `queue` itself defines --json (and --limit …), and commander lets an ancestor consume a known
 * option wherever it appears — `queue counts --json` never reaches `counts`. Read it from the chain.
 */
const wantsJson = (cmd) => Boolean(cmd.optsWithGlobals().json);
/** Run an action; any failure (bad input or API) ends as a readable one-line error + exit 1. */
async function run(prefix, codes, fn) {
    try {
        await fn();
    }
    catch (error) {
        (0, cliHelpers_1.fail)(prefix, error, codes);
    }
}
/** A decision may run the Agent synchronously and outlast the client timeout while the server carries on. */
function withTimeoutHint(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /timeout/i.test(message)
        ? new Error(`${message}（服务端可能仍在处理，尤其是会恢复 Agent 执行的计划审批 —— 请先用 good7ob workspace queue --status all 核对，不要盲目重试）`)
        : error;
}
async function moveItem(kind, rawId, json, body) {
    const id = (0, cliHelpers_1.parseId)(rawId, 'id');
    const item = await ApiClient_1.default.post(`${BASE}/${id}/${kind}`, body);
    (0, cliHelpers_1.emit)(json, item, () => (0, render_1.renderTransition)(kind, id, item));
}
async function decide(decision, rawId, comment, json) {
    const id = (0, cliHelpers_1.parseId)(rawId, 'id');
    const body = (0, input_1.buildActionBody)(decision, comment);
    const result = await ApiClient_1.default.post(`${BASE}/${id}/action`, body).catch((e) => {
        throw withTimeoutHint(e);
    });
    (0, cliHelpers_1.emit)(json, result, () => (0, render_1.renderDecision)(id, result));
}
function registerItemCommands(queue) {
    queue
        .command('counts')
        .description('Queue counters: active total per action type, plus snoozed / dismissed / done')
        .option('--json', 'Output as JSON')
        .action((_o, cmd) => run('获取待办队列计数失败', input_1.WORKSPACE_ERROR_CODES, async () => {
        const counts = await ApiClient_1.default.get(`${BASE}/counts`);
        (0, cliHelpers_1.emit)(wantsJson(cmd), counts, () => (0, render_1.renderQueueCounts)(counts ?? {}));
    }));
    const simple = [
        ['dismiss', 'Hide an item while its source stays live (idempotent; not for done items)', '忽略队列项失败'],
        ['done', 'Mark an item handled (idempotent)', '标记队列项已处理失败'],
        ['reopen', 'Bring a dismissed / snoozed / done item back as new (no-op for an active one)', '重新打开队列项失败'],
    ];
    simple.forEach(([kind, description, prefix]) => queue
        .command(`${kind} <id>`)
        .description(description)
        .option('--json', 'Output as JSON')
        .action((id, _o, cmd) => run(prefix, input_1.WORKSPACE_ERROR_CODES, () => moveItem(kind, id, wantsJson(cmd)))));
    queue
        .command('snooze <id>')
        .description(`Hide an item until a future time (at most ${input_1.MAX_SNOOZE_DAYS} days ahead; snoozing again moves the time)`)
        .requiredOption('--until <time>', 'ISO date-time (no offset = UTC, e.g. 2026-09-20T09:00:00Z) or relative: +30m, +2h, +1d')
        .option('--json', 'Output as JSON')
        .action((id, o, cmd) => run('稍后处理队列项失败', input_1.WORKSPACE_ERROR_CODES, () => moveItem('snooze', id, wantsJson(cmd), { until: (0, input_1.parseSnoozeUntil)(o.until) })));
}
function registerDecisionCommands(queue) {
    queue
        .command('approve <id>')
        .description('Approve the object behind an item in place: an approval request, a task plan (resumes the Agent) or a task completion')
        .option('--comment <text>', 'Optional note (recorded for approval requests only)')
        .option('--json', 'Output as JSON')
        .action((id, o, cmd) => run('批准队列项失败', input_1.ACTION_ERROR_CODES, () => decide('approve', id, o.comment, wantsJson(cmd))));
    queue
        .command('reject <id>')
        .description('Reject the object behind an item in place (approval request, task plan or task completion)')
        .requiredOption('--comment <text>', 'Why (required)')
        .option('--json', 'Output as JSON')
        .action((id, o, cmd) => run('驳回队列项失败', input_1.ACTION_ERROR_CODES, () => decide('reject', id, o.comment, wantsJson(cmd))));
}
function registerQueueCommands(workspace) {
    const queue = workspace
        .command('queue')
        .description('List items awaiting me, newest first (counts cover everything, the table is capped by --limit); subcommands act on one item')
        .allowExcessArguments(false)
        .option('-l, --limit <num>', `Max items to list (1-${input_1.MAX_QUEUE_LIMIT})`, '50')
        .option('--status <status>', `Filter by status (${input_1.QUEUE_STATUSES.join('|')}; default active)`)
        .option('--action-type <type>', `Filter by action type (${input_1.ACTION_TYPES.join('|')}); counts ignore it`)
        .option('--product <id>', 'Only items of this product')
        .option('--json', 'Output as JSON')
        .action((o) => run('获取我的待办队列失败', input_1.WORKSPACE_ERROR_CODES, async () => {
        const params = (0, input_1.buildQueueParams)(o);
        const result = await ApiClient_1.default.get(BASE, params);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, render_1.renderQueue)(result ?? {}, params.status));
    }));
    registerItemCommands(queue);
    registerDecisionCommands(queue);
}
exports.registerQueueCommands = registerQueueCommands;
//# sourceMappingURL=queueCommands.js.map