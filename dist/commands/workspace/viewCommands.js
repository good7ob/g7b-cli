"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerViewCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("./input");
const renderOverview_1 = require("./renderOverview");
const renderViews_1 = require("./renderViews");
const viewInput_1 = require("./viewInput");
/**
 * `workspace overview / tasks / products / product follow|unfollow / orgs` — read-only views of
 * everything that is "mine", plus following a product. All under /workspace; business errors
 * come back as HTTP 200 + non-200 `code`, mapped by `fail`.
 */
const BASE = '/workspace';
function registerViewCommands(workspace) {
    workspace
        .command('overview')
        .description('One-screen overview: queue counters, my task groups, my busiest products, recent activity')
        .option('--json', 'Output as JSON')
        .action(async (o) => {
        try {
            const overview = await ApiClient_1.default.get(`${BASE}/overview`);
            (0, cliHelpers_1.emit)(o.json, overview, () => (0, renderOverview_1.renderOverview)(overview ?? {}));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取工作台总览失败', error, input_1.WORKSPACE_ERROR_CODES);
        }
    });
    workspace
        .command('tasks')
        .description('My tasks: a summary plus the most urgent ones, or one page of a group with --group')
        .option('--group <group>', `Group (${viewInput_1.TASK_GROUPS.join('|')}); omit for the summary view`)
        .option('-p, --page <num>', 'Page number (with --group; default 1)')
        .option('--page-size <num>', `Items per page (with --group; 1-${viewInput_1.MAX_PAGE_SIZE}, default 20)`)
        .option('-l, --limit <num>', `Most urgent tasks to list without --group (1-${viewInput_1.MAX_URGENT_LIMIT}, default 5)`)
        .option('--json', 'Output as JSON')
        .action(async (o) => {
        try {
            const params = (0, viewInput_1.buildTasksParams)(o);
            const result = await ApiClient_1.default.get(`${BASE}/my-tasks`, params);
            (0, cliHelpers_1.emit)(o.json, result, () => o.group ? (0, renderViews_1.renderTaskGroup)((result ?? {})) : (0, renderViews_1.renderMyTasks)((result ?? {})));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取我的任务失败', error, input_1.WORKSPACE_ERROR_CODES);
        }
    });
    workspace
        .command('products')
        .description('My products as cards: my open tasks, blocked / AI-working counts, progress and risk')
        .option('--scope <scope>', `Scope (${viewInput_1.PRODUCT_SCOPES.join('|')}; default all)`)
        .option('--json', 'Output as JSON')
        .action(async (o) => {
        try {
            const result = await ApiClient_1.default.get(`${BASE}/my-products`, (0, viewInput_1.buildProductsParams)(o));
            (0, cliHelpers_1.emit)(o.json, result, () => (0, renderViews_1.renderProducts)(result ?? {}));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取我的产品失败', error, input_1.WORKSPACE_ERROR_CODES);
        }
    });
    const product = workspace.command('product').description('Follow / unfollow a product (shows under --scope following)');
    const followCommand = (verb, description, done) => product
        .command(`${verb} <productId>`)
        .description(description)
        .option('--json', 'Output as JSON')
        .action(async (rawId, o) => {
        try {
            const productId = (0, cliHelpers_1.parseId)(rawId, 'productId');
            const url = `${BASE}/my-products/${productId}/follow`;
            const result = verb === 'follow' ? await ApiClient_1.default.post(url) : await ApiClient_1.default.delete(url);
            (0, cliHelpers_1.emit)(o.json, result ?? { productId, following: verb === 'follow' }, () => `✓ ${done}: 产品 #${productId}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)(verb === 'follow' ? '关注产品失败' : '取消关注产品失败', error, {
                ...input_1.WORKSPACE_ERROR_CODES,
                1002: '产品不存在',
                2000: '无权限：只能关注自己所在组织（active 成员）的产品',
            });
        }
    });
    followCommand('follow', 'Follow a product (idempotent; organization members only)', '已关注');
    followCommand('unfollow', 'Stop following a product (idempotent; only affects me)', '已取消关注');
    workspace
        .command('orgs')
        .description('My organizations with my role and member / AI employee / product / active task counters')
        .option('--json', 'Output as JSON')
        .action(async (o) => {
        try {
            const result = await ApiClient_1.default.get(`${BASE}/my-orgs`);
            (0, cliHelpers_1.emit)(o.json, result, () => (0, renderViews_1.renderOrgs)(result ?? {}));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取我的组织失败', error, input_1.WORKSPACE_ERROR_CODES);
        }
    });
}
exports.registerViewCommands = registerViewCommands;
//# sourceMappingURL=viewCommands.js.map