"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAiCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const aiInput_1 = require("./aiInput");
const aiRender_1 = require("./aiRender");
const input_1 = require("./input");
/** A2: AI solution generation and the per-product estimation-correction factors. */
function registerAiCommands(idea) {
    idea
        .command('generate <ideaId>')
        .description(`Ask the AI for ${aiInput_1.MIN_COUNT}-${aiInput_1.MAX_COUNT} candidate solutions with estimates (draft/evaluating ideas only; spends tokens / API quota; results are ESTIMATES to be confirmed by a person)`)
        .option('--count <n>', `How many solutions (${aiInput_1.MIN_COUNT}-${aiInput_1.MAX_COUNT}, default 3)`)
        .option('--hints <text>', 'Extra requirements for the model (max 1000 chars)')
        .option('--json', 'Output as JSON')
        .action(async (ideaId, o) => {
        try {
            const id = (0, cliHelpers_1.parseId)(ideaId, 'ideaId');
            const body = (0, aiInput_1.buildGenerateBody)(o);
            const result = await ApiClient_1.default
                .post(`/forge/ideas/${id}/solutions/generate`, body, { timeout: aiInput_1.AI_TIMEOUT_MS })
                .catch((e) => {
                throw (0, aiInput_1.withTimeoutHint)(e, `good7ob idea get ${id}`);
            });
            (0, cliHelpers_1.emit)(o.json, result, () => (0, aiRender_1.renderGenerated)(id, result));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('AI 生成方案失败', error, aiInput_1.GENERATE_ERROR_CODES);
        }
    });
    idea
        .command('correction <productId>')
        .description('Show the estimation-correction factors (effort / cycle / cost) learned from completed effect reviews')
        .option('--json', 'Output as JSON')
        .action(async (productId, o) => {
        try {
            const result = await ApiClient_1.default.get(`/forge/products/${(0, cliHelpers_1.parseId)(productId, 'productId')}/estimation-correction`);
            (0, cliHelpers_1.emit)(o.json, result, () => (0, aiRender_1.renderCorrection)(result));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取估算修正系数失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
}
exports.registerAiCommands = registerAiCommands;
//# sourceMappingURL=aiCommands.js.map