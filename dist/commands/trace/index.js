"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTraceCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("./input");
const render_1 = require("./render");
/**
 * Trace-link commands (/forge/trace-links): directed edges between product objects
 * (source -linkType-> target). The backend does not check that either object exists,
 * so the caller owns that.
 *
 * Business errors come back as HTTP 200 + non-200 `code`; ApiClient throws on those and
 * `fail` maps the trace error codes to readable messages.
 */
const BASE = '/forge/trace-links';
const TYPE_HELP = 'object type code such as IDEA, REQUIREMENT, TASK (2-32 chars A-Z/0-9/_, case-insensitive)';
function registerTraceCommands(program) {
    const trace = program
        .command('trace')
        .description('Trace links — record how ideas, requirements, tasks and tests relate');
    trace
        .command('create')
        .description('Create a trace link source → target (a duplicate is rejected with code 1006)')
        .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID)')
        .requiredOption('--source-type <type>', `Source ${TYPE_HELP}`)
        .requiredOption('--source-id <id>', 'Source object id')
        .requiredOption('--target-type <type>', `Target ${TYPE_HELP}`)
        .requiredOption('--target-id <id>', 'Target object id')
        .requiredOption('--link-type <type>', `Relation (${input_1.LINK_TYPES.join('|')})`)
        .option('--json', 'Output as JSON')
        .action(async (o) => {
        try {
            const created = await ApiClient_1.default.post(BASE, (0, input_1.buildCreateBody)(o));
            (0, cliHelpers_1.emit)(o.json, created, () => `✓ 追溯关系已创建: #${created?.id ?? '-'} ${(0, render_1.describeLink)(created ?? {})}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('创建追溯关系失败', error, input_1.TRACE_ERROR_CODES);
        }
    });
    trace
        .command('list')
        .description('List trace links of a product, newest first (narrow by source / target / link type)')
        .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID)')
        .option('--source-type <type>', 'Filter by source type (needs --source-id)')
        .option('--source-id <id>', 'Filter by source id (needs --source-type)')
        .option('--target-type <type>', 'Filter by target type (needs --target-id)')
        .option('--target-id <id>', 'Filter by target id (needs --target-type)')
        .option('--link-type <type>', `Filter by relation (${input_1.LINK_TYPES.join('|')})`)
        .option('-p, --page <num>', 'Page number', '1')
        .option('--page-size <num>', 'Items per page (1-200)', '50')
        .option('--json', 'Output as JSON')
        .action(async (o) => {
        try {
            const params = (0, input_1.buildListParams)(o);
            const result = await ApiClient_1.default.get(BASE, params);
            (0, cliHelpers_1.emit)(o.json, result, () => (0, render_1.renderTraceList)(result, Number(params.pageNum), Number(params.pageSize)));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取追溯关系失败', error, input_1.TRACE_ERROR_CODES);
        }
    });
    trace
        .command('delete <id>')
        .description('Delete a trace link (soft delete; it can be created again)')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const lid = (0, cliHelpers_1.parseId)(id, 'id');
            await ApiClient_1.default.delete(`${BASE}/${lid}`);
            (0, cliHelpers_1.emit)(o.json, { deleted: true, id: lid }, () => `✓ 追溯关系已删除: #${lid}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('删除追溯关系失败', error, input_1.TRACE_ERROR_CODES);
        }
    });
}
exports.registerTraceCommands = registerTraceCommands;
//# sourceMappingURL=index.js.map