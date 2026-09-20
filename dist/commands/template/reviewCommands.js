"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerReviewCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("./input");
const renderMisc_1 = require("./renderMisc");
const versionInput_1 = require("./versionInput");
const url = (id) => `/templates/${(0, cliHelpers_1.parseId)(id, 'id')}/reviews`;
/** `template review add|list|rm`: 1-5 star reviews (only users who installed / used the template may write one). */
function registerReviewCommands(tpl) {
    const review = tpl.command('review').description('Template reviews (1-5 stars + comment)');
    review
        .command('add <id>')
        .description('Rate a template (a second call overwrites your review; you must have installed or used it, and not own it)')
        .requiredOption('--rating <1-5>', 'Star rating 1-5')
        .option('--comment <text>', 'Comment (max 1000 chars)')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('评价失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const target = url(id);
        const saved = await ApiClient_1.default.post(target, (0, versionInput_1.buildReviewBody)(o));
        (0, cliHelpers_1.emit)(o.json, saved, () => (0, renderMisc_1.renderReviewSaved)(saved, Number(id)));
    }));
    review
        .command('list <id>')
        .description('List reviews of a template, newest first')
        .option('-p, --page <num>', 'Page number', '1')
        .option('--page-size <num>', 'Items per page (1-50)', '20')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('获取评价失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const target = url(id);
        const params = (0, input_1.pageParams)(o);
        const result = await ApiClient_1.default.get(target, params);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderMisc_1.renderReviewList)(result, params.pageNum, params.pageSize));
    }));
    review
        .command('rm <id>')
        .description('Delete my review (you can review again afterwards)')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('删除评价失败', input_1.TEMPLATE_ERROR_CODES, async () => {
        const target = url(id);
        await ApiClient_1.default.delete(target);
        (0, cliHelpers_1.emit)(o.json, { deleted: true, id: Number(id) }, () => `✓ 已删除我对模板 #${id} 的评价`);
    }));
}
exports.registerReviewCommands = registerReviewCommands;
//# sourceMappingURL=reviewCommands.js.map