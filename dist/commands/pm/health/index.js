"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHealthCommands = exports.HEALTH_ERROR_CODES = exports.MAX_NOTE = void 0;
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
const cliHelpers_1 = require("../../../utils/cliHelpers");
const render_1 = require("./render");
/**
 * Product health dashboard (/progress/products/{id}/health, prd-0080).
 * Needs org membership on the product. Not the same thing as
 * /forge/products/{id}/progress (requirement-structuring completeness).
 */
exports.MAX_NOTE = 500;
exports.HEALTH_ERROR_CODES = {
    40480: '产品不存在或已删除',
    40380: '无权访问：你不是该产品所属组织的成员',
    40080: '基线备注过长（最多 500 字符）',
};
// `health` and its subcommands all declare --json; commander hands a flag placed after
// the subcommand name to the parent that also knows it, so subcommands read the merged
// options (cmd.optsWithGlobals()) instead of their own.
const output = (json, data, text) => console.log(json ? JSON.stringify(data, null, 2) : text());
function registerHealthCommands(pmCommand) {
    const health = pmCommand
        .command('health <productId>')
        .description('Product health KPI (subcommands: modules, baseline)')
        .option('--json', 'Output as JSON')
        .action(async (productId, o) => {
        try {
            const id = (0, cliHelpers_1.parseId)(productId, 'productId');
            const kpi = await ApiClient_1.default.get(`/progress/products/${id}/health`);
            output(o.json, kpi, () => (0, render_1.renderHealth)(kpi ?? {}));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取产品健康度失败', error, exports.HEALTH_ERROR_CODES);
        }
    });
    health
        .command('modules <productId>')
        .description('Per-module progress, sorted by delay days (descending)')
        .option('--json', 'Output as JSON')
        .action(async (productId, _o, cmd) => {
        try {
            const id = (0, cliHelpers_1.parseId)(productId, 'productId');
            const o = cmd.optsWithGlobals();
            const modules = await ApiClient_1.default.get(`/progress/products/${id}/health/modules`);
            output(o.json, modules, () => (0, render_1.renderModules)(modules ?? []));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取模块健康度失败', error, exports.HEALTH_ERROR_CODES);
        }
    });
    health
        .command('baseline <productId>')
        .description('Snapshot the CURRENT scope as the new baseline (replaces the active one)')
        .option('--note <text>', `Why (max ${exports.MAX_NOTE} chars)`)
        .option('--json', 'Output as JSON')
        .action(async (productId, _o, cmd) => {
        try {
            const id = (0, cliHelpers_1.parseId)(productId, 'productId');
            const o = cmd.optsWithGlobals();
            const body = o.note === undefined ? {} : { note: (0, cliHelpers_1.checkMaxLength)(o.note, exports.MAX_NOTE, '--note') };
            const baseline = await ApiClient_1.default.post(`/progress/products/${id}/health/baseline`, body);
            output(o.json, baseline, () => (0, render_1.renderBaseline)(baseline ?? {}));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('设置基线失败', error, exports.HEALTH_ERROR_CODES);
        }
    });
}
exports.registerHealthCommands = registerHealthCommands;
//# sourceMappingURL=index.js.map