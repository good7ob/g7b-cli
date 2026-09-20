"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerForecastCommands = void 0;
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
const cliHelpers_1 = require("../../../utils/cliHelpers");
const costInput_1 = require("./costInput");
const intelInput_1 = require("./intelInput");
const renderDiagnosis_1 = require("./renderDiagnosis");
const renderForecast_1 = require("./renderForecast");
/**
 * C2 forecasting commands under `pm health` (backend ProductIntelligenceController, api-0090 §8, §11, §12):
 * forecast, what-if, diagnosis, explain. Result envelope: business errors are HTTP 200 + code
 * 1000/1001/1002/2000. No confirmation prompts. Every leaf declares --json but reads
 * `cmd.optsWithGlobals()` (commander hands a flag placed before the subcommand to the parent).
 */
const P = (id) => `/progress/products/${id}`;
const EXPLAIN_TIMEOUT_HINT = '服务端可能仍在调用模型；解读不落库、不改任何数据，可以稍后重试（10 分钟内相同事实与问题会命中缓存、不再扣费）';
function registerForecastCommands(health) {
    health
        .command('forecast <productId>')
        .description('P50/P80 completion forecast from the weekly velocity history (shows "数据不足", never a made-up date, when history is too short)')
        .option('--release <id>', 'Release-level forecast instead of product-level')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => (0, cliHelpers_1.guarded)('获取完成预测失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const f = await ApiClient_1.default.get(`${P((0, cliHelpers_1.parseId)(productId, 'productId'))}/forecast`, (0, costInput_1.releaseParams)(o.release));
        (0, cliHelpers_1.emit)(o.json, f, () => (0, renderForecast_1.renderForecast)(f ?? {}));
    }));
    health
        .command('what-if <productId>')
        .description('Simulate a scenario against the forecast (pure calculation — nothing is saved). Flags combine; none = scenario equals baseline')
        .option('--add-scope <n>', 'Scope added (0 - 1000000000, in the product\'s workload unit)')
        .option('--remove-scope <n>', 'Open scope moved out (0 - 1000000000; capped at the remaining scope)')
        .option('--velocity-multiplier <x>', 'Multiply every weekly velocity sample (0.1 - 10)')
        .option('--extra-capacity <n>', 'Extra scope per week, e.g. more people / AI (0 - 1000000)')
        .option('--deadline <yyyy-MM-dd>', 'Target date: report whether baseline and scenario meet it')
        .option('--release <id>', 'Simulate one release only')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => (0, cliHelpers_1.guarded)('What-if 模拟失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        const result = await ApiClient_1.default.post(`${P(id)}/what-if`, (0, intelInput_1.buildWhatIfBody)(o));
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderForecast_1.renderWhatIf)(result ?? {}));
    }));
    health
        .command('diagnosis <productId>')
        .description('Deterministic diagnosis: findings (severity + code) and the facts behind them — module delay, scope growth, blockers, velocity')
        .option('--release <id>', 'Release-level diagnosis instead of product-level')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => (0, cliHelpers_1.guarded)('获取进度诊断失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const d = await ApiClient_1.default.get(`${P((0, cliHelpers_1.parseId)(productId, 'productId'))}/diagnosis`, (0, costInput_1.releaseParams)(o.release));
        (0, cliHelpers_1.emit)(o.json, d, () => (0, renderDiagnosis_1.renderDiagnosis)(d ?? {}));
    }));
    health
        .command('explain <productId>')
        .description('AI explanation over the diagnosis facts (AI-generated, needs human review; consumes AI tokens; falls back to the findings when AI is unavailable)')
        .option('--release <id>', 'Limit to one release')
        .option('--question <text>', `Your question (max ${intelInput_1.MAX_QUESTION} chars; default: why is the progress what it is and what next)`)
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => (0, cliHelpers_1.guarded)('获取 AI 解读失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        const body = (0, intelInput_1.buildExplainBody)(o);
        const e = await ApiClient_1.default.post(`${P(id)}/explain`, body, cliHelpers_1.AI_REQUEST_CONFIG).catch((err) => {
            throw (0, cliHelpers_1.withTimeoutHint)(err, EXPLAIN_TIMEOUT_HINT);
        });
        (0, cliHelpers_1.emit)(o.json, e, () => (0, renderDiagnosis_1.renderExplain)(e ?? {}));
    }));
}
exports.registerForecastCommands = registerForecastCommands;
//# sourceMappingURL=forecastCommands.js.map