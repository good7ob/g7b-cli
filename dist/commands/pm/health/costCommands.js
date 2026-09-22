"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCostCommands = void 0;
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
const cliHelpers_1 = require("../../../utils/cliHelpers");
const costInput_1 = require("./costInput");
const renderCost_1 = require("./renderCost");
/**
 * C2 cost commands under `pm health` (api-0090 §9, §10): `cost` (cost progress), `budget get|set|clear`,
 * `cost-entry list|add|update|delete`. Reads = org members, writes = org owner/admin (2000 otherwise).
 * One currency per product; `source=auto` entries are read-only (1007). No confirmation prompts.
 */
const P = (id) => `/progress/products/${id}`;
/** `?releaseId=N` for endpoints whose HTTP client cannot carry query params (DELETE). */
const releaseQuery = (release) => (release === undefined ? '' : `?releaseId=${(0, cliHelpers_1.parseId)(release, '--release')}`);
/**
 * The budget PUT replaces the whole budget, and an omitted tokenPricePerMillion clears the saved one. So unless the
 * user passed --token-price-per-million / --clear-token-price, read the current budget of the same scope and resend its
 * price. A failed read aborts the write (guarded): silently clearing the price is worse than not saving.
 */
async function keepSavedTokenPrice(productId, o, body) {
    if (o.tokenPricePerMillion !== undefined || o.clearTokenPrice)
        return;
    const current = await ApiClient_1.default.get(`${P(productId)}/budget`, (0, costInput_1.releaseParams)(o.release));
    if (current?.configured && current.tokenPricePerMillion != null)
        body.tokenPricePerMillion = current.tokenPricePerMillion;
}
function registerBudget(health) {
    const budget = health.command('budget').description('Budget of a product or release (subcommands: get, set, clear)');
    budget
        .command('get <productId>')
        .description('Show the budget (says so when none is set)')
        .option('--release <id>', 'Release-level budget instead of product-level')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => (0, cliHelpers_1.guarded)('获取预算失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        const b = await ApiClient_1.default.get(`${P(id)}/budget`, (0, costInput_1.releaseParams)(o.release));
        (0, cliHelpers_1.emit)(o.json, b, () => (0, renderCost_1.renderBudget)(b ?? {}, { productId: id, releaseId: o.release && Number(o.release) }));
    }));
    budget
        .command('set <productId>')
        .description('Set / replace the budget (org owner/admin). The first amount written fixes the product\'s currency')
        .requiredOption('--amount <n>', 'Budget, > 0, at most 2 decimals (max 9999999999.99)')
        .requiredOption('--currency <code>', '3-letter currency code, e.g. CNY')
        .option('--labor-rate <n>', 'Rate per hour that turns task actual hours into a derived labor cost (0 - 100000)')
        .option('--token-price-per-million <n>', 'Money per 1,000,000 tokens (blended in/out, budget currency; 0 - 100000, up to 4 decimals) that turns task token usage into a derived AI token cost. Omitted = the saved price is kept')
        .option('--clear-token-price', 'Drop the saved token price (no derived AI token cost afterwards)')
        .option('--note <text>', 'Note (max 500 chars)')
        .option('--release <id>', 'Release-level budget instead of product-level')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => (0, cliHelpers_1.guarded)('设置预算失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        const body = (0, costInput_1.buildBudgetBody)(o);
        await keepSavedTokenPrice(id, o, body);
        const saved = await ApiClient_1.default.put(`${P(id)}/budget`, body);
        (0, cliHelpers_1.emit)(o.json, saved, () => (0, renderCost_1.renderBudget)({ configured: true, ...saved }, { productId: id, releaseId: o.release && Number(o.release) }, true));
    }));
    budget
        .command('clear <productId>')
        .description('Delete the budget (org owner/admin; it can be set again afterwards)')
        .option('--release <id>', 'Release-level budget instead of product-level')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => (0, cliHelpers_1.guarded)('删除预算失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        await ApiClient_1.default.delete(`${P(id)}/budget${releaseQuery(o.release)}`);
        const result = { productId: id, releaseId: o.release ? Number(o.release) : null, deleted: true };
        (0, cliHelpers_1.emit)(o.json, result, () => `✓ 已删除预算: 产品 #${id}${o.release ? `  Release #${o.release}` : '（产品级）'}`);
    }));
}
function registerCostEntries(health) {
    const entry = health.command('cost-entry').description('Actual cost entries (subcommands: list, add, update, delete)');
    const flags = (c) => c
        .requiredOption('--category <category>', 'labor | cloud | ai_token | other')
        .requiredOption('--amount <n>', 'Amount, > 0, at most 2 decimals')
        .requiredOption('--currency <code>', '3-letter currency code; must equal the product\'s existing currency')
        .requiredOption('--date <yyyy-MM-dd>', 'Day the cost was incurred (2000-01-01 to tomorrow, UTC)')
        .option('--release <id>', 'Attribute it to a release (omitted = product level)')
        .option('--note <text>', 'Note (max 500 chars)')
        .option('--json', 'Output as JSON');
    entry
        .command('list <productId>')
        .description('Cost entries, newest incurred day first')
        .option('--category <category>', 'labor | cloud | ai_token | other')
        .option('--release <id>', 'Only this release')
        .option('--from <yyyy-MM-dd>', 'Incurred on or after')
        .option('--to <yyyy-MM-dd>', 'Incurred on or before')
        .option('-p, --page <num>', 'Page number', '1')
        .option('--page-size <num>', 'Items per page (1-100)', '20')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => (0, cliHelpers_1.guarded)('获取成本条目失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        const page = await ApiClient_1.default.get(`${P(id)}/cost-entries`, (0, costInput_1.buildCostEntryListParams)(o));
        (0, cliHelpers_1.emit)(o.json, page, () => (0, renderCost_1.renderCostEntries)(page ?? {}));
    }));
    flags(entry.command('add <productId>').description('Record an actual cost (org owner/admin)')).action((productId, _o, cmd) => (0, cliHelpers_1.guarded)('记录成本条目失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        const created = await ApiClient_1.default.post(`${P(id)}/cost-entries`, (0, costInput_1.buildCostEntryBody)(o));
        (0, cliHelpers_1.emit)(o.json, created, () => (0, renderCost_1.renderCostEntry)(created ?? { id: 0 }, '记录'));
    }));
    flags(entry.command('update <id>').description('REPLACE a manual entry as a whole (org owner/admin): an omitted --release / --note is cleared; source=auto entries are read-only (1007)'))
        .action((id, _o, cmd) => (0, cliHelpers_1.guarded)('更新成本条目失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const eid = (0, cliHelpers_1.parseId)(id, 'id');
        const updated = await ApiClient_1.default.put(`/progress/cost-entries/${eid}`, (0, costInput_1.buildCostEntryBody)(o));
        (0, cliHelpers_1.emit)(o.json, updated, () => (0, renderCost_1.renderCostEntry)(updated ?? { id: eid }, '更新'));
    }));
    entry
        .command('delete <id>')
        .description('Delete a manual entry (org owner/admin; source=auto entries are read-only, 1007)')
        .option('--json', 'Output as JSON')
        .action((id, _o, cmd) => (0, cliHelpers_1.guarded)('删除成本条目失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const eid = (0, cliHelpers_1.parseId)(id, 'id');
        await ApiClient_1.default.delete(`/progress/cost-entries/${eid}`);
        (0, cliHelpers_1.emit)(cmd.optsWithGlobals().json, { id: eid, deleted: true }, () => `✓ 成本条目 #${eid} 已删除`);
    }));
}
function registerCostCommands(health) {
    health
        .command('cost <productId>')
        .description('Cost progress next to development and time progress: budget, actuals by category, derived labor and derived AI token cost (needs a budget token price), EAC')
        .option('--release <id>', 'Release-level cost instead of product-level')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => (0, cliHelpers_1.guarded)('获取成本进度失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const c = await ApiClient_1.default.get(`${P((0, cliHelpers_1.parseId)(productId, 'productId'))}/cost`, (0, costInput_1.releaseParams)(o.release));
        (0, cliHelpers_1.emit)(o.json, c, () => (0, renderCost_1.renderCost)(c ?? {}));
    }));
    registerBudget(health);
    registerCostEntries(health);
}
exports.registerCostCommands = registerCostCommands;
//# sourceMappingURL=costCommands.js.map