"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerReviewCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const reviewInput_1 = require("./reviewInput");
const reviewRender_1 = require("./reviewRender");
/**
 * A2 effect review (forge/ideas/{id}/effect-review): after release, compare what was expected
 * (chosen solution) with what happened; completing it validates the idea and feeds the
 * estimation-correction factors. At most one review per idea.
 */
const path = (ideaId) => `/forge/ideas/${(0, cliHelpers_1.parseId)(ideaId, 'ideaId')}/effect-review`;
function registerReviewCommands(idea) {
    const review = idea.command('review').description('Effect review of a released idea — expected vs actual, feeds estimation correction (A2)');
    review
        .command('start <ideaId>')
        .description('Create the review draft, or refresh its snapshot / actuals (idea must be planning|developing|released)')
        .option('--json', 'Output as JSON')
        .action(async (ideaId, o) => {
        try {
            const result = await ApiClient_1.default.post(path(ideaId));
            (0, cliHelpers_1.emit)(o.json, result, () => (0, reviewRender_1.renderReview)(result));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('创建 / 刷新效果复盘失败', error, reviewInput_1.REVIEW_ERROR_CODES);
        }
    });
    review
        .command('get <ideaId>')
        .description('Show the review with metrics and accuracy (actual cost = labor only: task hours × budget labor rate; — when not available)')
        .option('--json', 'Output as JSON')
        .action(async (ideaId, o) => {
        try {
            const result = await ApiClient_1.default.get(path(ideaId));
            (0, cliHelpers_1.emit)(o.json, result, () => (0, reviewRender_1.renderReview)(result));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取效果复盘失败', error, reviewInput_1.REVIEW_ERROR_CODES);
        }
    });
    review
        .command('metrics <ideaId>')
        .description('Set the manual metrics (REPLACES the whole list) and/or notes of a draft review')
        .option('--metric <name:expected:actual:unit>', 'Metric, repeatable, max 20; only name is required; leave expected/actual empty for "not available" (e.g. NPS:40::pts)', cliHelpers_1.collect)
        .option('--clear-metrics', 'Remove all metrics')
        .option('--notes <text>', 'Review notes (max 2000 chars)')
        .option('--json', 'Output as JSON')
        .action(async (ideaId, o) => {
        try {
            const body = (0, reviewInput_1.buildReviewUpdateBody)(o);
            const result = await ApiClient_1.default.put(path(ideaId), body);
            (0, cliHelpers_1.emit)(o.json, result, () => (0, reviewRender_1.renderReview)(result));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('更新效果复盘失败', error, reviewInput_1.REVIEW_ERROR_CODES);
        }
    });
    review
        .command('complete <ideaId>')
        .description('Complete the review: freezes accuracy, moves the idea released → validated, recomputes correction factors')
        .option('--json', 'Output as JSON')
        .action(async (ideaId, o) => {
        try {
            const result = await ApiClient_1.default.post(`${path(ideaId)}/complete`);
            (0, cliHelpers_1.emit)(o.json, result, () => `✓ 效果复盘已完成，Idea 已 validated\n${(0, reviewRender_1.renderReview)(result)}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('完成效果复盘失败', error, reviewInput_1.REVIEW_ERROR_CODES);
        }
    });
}
exports.registerReviewCommands = registerReviewCommands;
//# sourceMappingURL=reviewCommands.js.map