"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProgressCommands = void 0;
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
const cliHelpers_1 = require("../../../utils/cliHelpers");
const input_1 = require("./input");
const renderProgress_1 = require("./renderProgress");
/**
 * C1 progress commands under `pm health` (backend ProductMetricsController). These endpoints
 * use the Result envelope: business errors are HTTP 200 + code 1000/1001/1002/2000, unlike the
 * older /health endpoints (40480 / 40380 / 40080). No confirmation prompts anywhere.
 *
 * Every leaf declares --json but reads `cmd.optsWithGlobals()`: commander hands a flag placed
 * before the subcommand to the parent, and the merged options cover both placements.
 */
const P = (id) => `/progress/products/${id}`;
/** Runs an action, mapping any failure (input or API) to a readable exit-1 message. */
const guarded = (prefix, fn) => fn().catch((e) => (0, cliHelpers_1.fail)(prefix, e, input_1.PROGRESS_ERROR_CODES));
function registerConfig(health) {
    const config = health
        .command('config')
        .description('Progress config: workload basis + status completion (subcommands: get, set)');
    config
        .command('get <productId>')
        .description('Show the workload basis and status-completion mapping (defaults if never configured)')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => guarded('获取进度配置失败', async () => {
        const c = await ApiClient_1.default.get(`${P((0, cliHelpers_1.parseId)(productId, 'productId'))}/config`);
        (0, cliHelpers_1.emit)(cmd.optsWithGlobals().json, c, () => (0, renderProgress_1.renderConfig)(c ?? {}));
    }));
    config
        .command('set <productId>')
        .description('Replace the config (org owner/admin). Omitting --status-completion clears existing overrides')
        .requiredOption('--basis <basis>', 'Workload basis: ESTIMATED_HOURS | STORY_POINT | WEIGHT')
        .option('--status-completion <pairs>', 'Completion % per status, e.g. in_progress=30,blocked=50 (0-100; not completed/cancelled)')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => guarded('保存进度配置失败', async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        const saved = await ApiClient_1.default.put(`${P(id)}/config`, (0, input_1.buildConfigBody)(o));
        (0, cliHelpers_1.emit)(o.json, saved, () => (0, renderProgress_1.renderConfig)(saved ?? {}, true));
    }));
}
function registerScopeChanges(health) {
    health
        .command('scope-changes <productId>')
        .description('Scope change history, newest first (auto entries from daily snapshots + manual ones)')
        .option('--release <id>', 'Only this release')
        .option('-p, --page <num>', 'Page number', '1')
        .option('--page-size <num>', 'Items per page (1-100)', '20')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => guarded('获取范围变更失败', async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        const page = await ApiClient_1.default.get(`${P(id)}/scope-changes`, (0, input_1.buildScopeChangesParams)(o));
        (0, cliHelpers_1.emit)(o.json, page, () => (0, renderProgress_1.renderScopeChanges)(page ?? {}));
    }));
    const change = health.command('scope-change').description('Record / annotate a scope change (subcommands: add, annotate)');
    change
        .command('add <productId>')
        .description('Record a scope change by hand (any org member)')
        .requiredOption('--delta <n>', 'Signed scope change in the product\'s basis unit, non-zero (e.g. 30 or -12.5)')
        .requiredOption('--reason <text>', 'Why (max 500 chars)')
        .option('--release <id>', 'Attribute it to a release of this product')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => guarded('记录范围变更失败', async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        const created = await ApiClient_1.default.post(`${P(id)}/scope-changes`, (0, input_1.buildScopeChangeBody)(o));
        (0, cliHelpers_1.emit)(o.json, created, () => (0, renderProgress_1.renderScopeChange)(created ?? { id: 0 }, '记录'));
    }));
    change
        .command('annotate <id>')
        .description('Set / replace the reason of any scope change entry, auto ones included (any org member)')
        .requiredOption('--reason <text>', 'Reason (max 500 chars)')
        .option('--json', 'Output as JSON')
        .action((id, _o, cmd) => guarded('补充范围变更原因失败', async () => {
        const o = cmd.optsWithGlobals();
        const sid = (0, cliHelpers_1.parseId)(id, 'id');
        const updated = await ApiClient_1.default.put(`/progress/scope-changes/${sid}`, (0, input_1.buildAnnotateBody)(o.reason));
        (0, cliHelpers_1.emit)(o.json, updated, () => (0, renderProgress_1.renderScopeChange)(updated ?? { id: sid }, '更新'));
    }));
}
function registerBurnupAndSnapshots(health) {
    health
        .command('burnup <productId>')
        .description('Burnup: scope vs completed per day (table + text chart). Defaults to the last 30 days')
        .option('--from <yyyy-MM-dd>', 'Start date')
        .option('--to <yyyy-MM-dd>', 'End date (default: today UTC); span at most 366 days')
        .option('--release <id>', 'Release-level burnup instead of product-level')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => guarded('获取 Burnup 失败', async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        const burnup = await ApiClient_1.default.get(`${P(id)}/burnup`, (0, input_1.buildBurnupParams)(o));
        (0, cliHelpers_1.emit)(o.json, burnup, () => (0, renderProgress_1.renderBurnup)(burnup ?? {}));
    }));
    const snapshots = health.command('snapshots').description('Daily progress snapshots (subcommands: rebuild)');
    snapshots
        .command('rebuild <productId>')
        .description('Backfill missing daily snapshots from task history (org owner/admin; never overwrites)')
        .option('--days <n>', 'How many days back from yesterday (1-90, default 30)')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => guarded('重建快照失败', async () => {
        const o = cmd.optsWithGlobals();
        const result = await ApiClient_1.default.post((0, input_1.rebuildUrl)((0, cliHelpers_1.parseId)(productId, 'productId'), o.days));
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderProgress_1.renderRebuild)(result ?? {}));
    }));
}
function registerProgressCommands(health) {
    registerConfig(health);
    registerScopeChanges(health);
    registerBurnupAndSnapshots(health);
}
exports.registerProgressCommands = registerProgressCommands;
//# sourceMappingURL=progressCommands.js.map