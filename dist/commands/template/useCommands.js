"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUseCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const dryRun_1 = require("./dryRun");
const outFile_1 = require("./outFile");
const renderDryRun_1 = require("./renderDryRun");
const renderUse_1 = require("./renderUse");
const useFlags_1 = require("./useFlags");
const useInput_1 = require("./useInput");
const BASE = '/templates';
/**
 * `template use`: instantiate a template into real business objects (tasks, module, release, test cases, PRD
 * session, workflow template) or a rendered document, in ONE server transaction. `--dry-run` previews instead.
 */
function registerUseCommands(tpl) {
    (0, useFlags_1.withOutFlags)((0, useFlags_1.withVarFlags)((0, useFlags_1.withTargetFlags)(tpl.command('use <id>'))), 'the rendered document body (or rendered JSON)')
        .description('Instantiate a template into your product (one transaction; not idempotent — see `template instances` before retrying)')
        .option('--version <x.y.z>', 'Version to use (must have been published; default the current published one)')
        .option('--dry-run', 'Preview only: check dependencies and variables, render locally, create nothing')
        .option('--json', 'Output as JSON')
        .action((id, o) => (0, cliHelpers_1.guarded)('实例化模板失败', useInput_1.USE_ERROR_CODES, async () => {
        const tid = (0, cliHelpers_1.parseId)(id, 'id');
        const body = (0, useInput_1.buildInstantiateBody)(o);
        const out = (0, outFile_1.checkOutTarget)(o);
        if (o.dryRun) {
            const report = await (0, dryRun_1.dryRunInstantiate)(tid, o, body, body.variables);
            return (0, outFile_1.emitWithOut)(o.json, report, (writtenTo) => (0, renderDryRun_1.renderDryRun)(report, writtenTo), {
                file: out, force: o.force, content: report.renderedContent, failPrefix: '预演已完成，但写入文件失败',
            });
        }
        const instance = await ApiClient_1.default
            .post(`${BASE}/${tid}/instantiate`, body, useInput_1.INSTANTIATE_REQUEST)
            .catch((error) => {
            throw (0, cliHelpers_1.withTimeoutHint)(error, useInput_1.TIMEOUT_HINT);
        });
        (0, outFile_1.emitWithOut)(o.json, instance, (writtenTo) => (0, renderUse_1.renderInstantiated)(instance ?? {}, writtenTo), {
            file: out, force: o.force, content: instance?.renderedContent, failPrefix: `实例 #${instance?.id ?? '?'} 已创建，但写入文件失败`,
        });
    }));
}
exports.registerUseCommands = registerUseCommands;
//# sourceMappingURL=useCommands.js.map