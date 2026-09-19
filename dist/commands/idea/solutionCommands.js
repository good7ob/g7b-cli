"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSolutionCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("./input");
const solutionInput_1 = require("./solutionInput");
const BASE = '/forge/ideas';
const oneOf = (values) => values.join('|');
function withSolutionNotes(cmd) {
    return cmd
        .option('--description <text>', 'Description')
        .option('--cost-note <text>', 'Cost note (max 500 chars)')
        .option('--cycle-note <text>', 'Cycle / timeline note (max 500 chars)')
        .option('--effect-note <text>', 'Expected effect note (max 500 chars)');
}
/** Structured estimate flags, shared by `add` and `update`. */
function withEstimate(cmd) {
    return cmd
        .option('--effort-frontend <days>', 'Frontend person-days (0-99999.9, 1 decimal)')
        .option('--effort-backend <days>', 'Backend person-days (0-99999.9, 1 decimal)')
        .option('--effort-ai <days>', 'AI / RAG person-days (0-99999.9, 1 decimal)')
        .option('--effort-test <days>', 'Test person-days (0-99999.9, 1 decimal)')
        .option('--effort-pm <days>', 'PM / design person-days (0-99999.9, 1 decimal)')
        .option('--cost <amount>', 'Estimated total cost (0-9999999999.99, 2 decimals)')
        .option('--cloud-cost <amount>', 'Cloud cost per month (2 decimals)')
        .option('--token-cost <amount>', 'AI token cost per month (2 decimals)')
        .option('--maintenance-cost <amount>', 'Maintenance cost per month (2 decimals)')
        .option('--cycle-weeks <weeks>', 'Estimated cycle in weeks (0-999.9, 1 decimal)')
        .option('--technical-risk <level>', `Technical risk (${oneOf(solutionInput_1.LEVELS)})`)
        .option('--product-risk <level>', `Product risk (${oneOf(solutionInput_1.LEVELS)})`)
        .option('--confidence <level>', `Estimate confidence (${oneOf(solutionInput_1.LEVELS)})`)
        .option('--estimation-source <source>', `Estimate source (${oneOf(solutionInput_1.ESTIMATION_SOURCES)}, default manual)`)
        .option('--expected-effect <text>', 'Expected effect (max 2000 chars)')
        .option('--kpi <name:current:target:unit>', 'Effect KPI, repeatable, max 20 (only name is required)', cliHelpers_1.collect);
}
function registerSolutionCommands(idea) {
    const solution = idea.command('solution').description('Candidate solutions of an idea');
    withEstimate(withSolutionNotes(solution.command('add <ideaId>')))
        .description('Add a solution with an optional structured estimate (idea must be draft or evaluating)')
        .requiredOption('--name <name>', 'Solution name (max 200 chars)')
        .option('--json', 'Output as JSON')
        .action(async (ideaId, o) => {
        try {
            const id = (0, cliHelpers_1.parseId)(ideaId, 'ideaId');
            const body = (0, solutionInput_1.buildSolutionCreateBody)(o);
            const created = await ApiClient_1.default.post(`${BASE}/${id}/solutions`, body);
            (0, cliHelpers_1.emit)(o.json, created, () => `✓ 方案已添加: #${created?.id ?? '-'} ${body.name}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('添加方案失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    withEstimate(withSolutionNotes(solution.command('update <ideaId> <solutionId>')))
        .description('Update a solution (omitted flags stay unchanged; --kpi replaces the whole KPI list)')
        .option('--name <name>', 'Solution name (max 200 chars)')
        .option('--clear-kpi', 'Remove all KPIs')
        .option('--json', 'Output as JSON')
        .action(async (ideaId, solutionId, o) => {
        try {
            const id = (0, cliHelpers_1.parseId)(ideaId, 'ideaId');
            const sid = (0, cliHelpers_1.parseId)(solutionId, 'solutionId');
            const updated = await ApiClient_1.default.put(`${BASE}/${id}/solutions/${sid}`, (0, solutionInput_1.buildSolutionUpdateBody)(o));
            (0, cliHelpers_1.emit)(o.json, updated, () => `✓ 方案已更新: #${sid}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('更新方案失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
    solution
        .command('delete <ideaId> <solutionId>')
        .description('Delete a solution')
        .action(async (ideaId, solutionId) => {
        try {
            const id = (0, cliHelpers_1.parseId)(ideaId, 'ideaId');
            const sid = (0, cliHelpers_1.parseId)(solutionId, 'solutionId');
            await ApiClient_1.default.delete(`${BASE}/${id}/solutions/${sid}`);
            console.log(`✓ 方案已删除: #${sid}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('删除方案失败', error, input_1.IDEA_ERROR_CODES);
        }
    });
}
exports.registerSolutionCommands = registerSolutionCommands;
//# sourceMappingURL=solutionCommands.js.map