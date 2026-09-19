"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerApprovalCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("./input");
const render_1 = require("./render");
/**
 * Approval commands (/approvals): decide the requests other features open (a release
 * asks via `good7ob release request-approval`). There is no "create approval" command
 * because the backend has no such endpoint by design.
 *
 * Business errors come back as HTTP 200 + non-200 `code`; ApiClient throws on those and
 * `fail` maps the approval error codes to readable messages.
 */
const BASE = '/approvals';
function registerApprovalCommands(program) {
    const approval = program
        .command('approval')
        .description('Approvals — list, inspect, approve, reject or cancel requests (e.g. release approvals)');
    approval
        .command('list')
        .description('List approvals of my organizations, newest first (--mine: only those I can decide)')
        .option('--status <status>', `Filter by status (${input_1.STATUSES.join('|')})`)
        .option('--target-type <type>', 'Filter by target type, e.g. RELEASE (case-insensitive)')
        .option('--target-id <id>', 'Filter by target id (with --target-type)')
        .option('--product <id>', 'Filter by product id')
        .option('--mine', 'Only pending requests I can decide (implies --status pending)')
        .option('-p, --page <num>', 'Page number', '1')
        .option('--page-size <num>', 'Items per page (1-100)', '20')
        .option('--json', 'Output as JSON')
        .action(async (o) => {
        try {
            const params = (0, input_1.buildListParams)(o);
            const result = await ApiClient_1.default.get(BASE, params);
            (0, cliHelpers_1.emit)(o.json, result, () => (0, render_1.renderApprovalList)(result, Number(params.pageNum), Number(params.pageSize)));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取审批列表失败', error, input_1.APPROVAL_ERROR_CODES);
        }
    });
    approval
        .command('get <id>')
        .description('Show an approval, including whether I can decide / cancel it')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const detail = await ApiClient_1.default.get(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}`);
            (0, cliHelpers_1.emit)(o.json, detail, () => (0, render_1.renderApprovalDetail)(detail ?? { id: Number(id) }));
        }
        catch (error) {
            (0, cliHelpers_1.fail)('获取审批详情失败', error, input_1.APPROVAL_ERROR_CODES);
        }
    });
    const decide = (cmd, verb, done, failPrefix) => cmd
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const aid = (0, cliHelpers_1.parseId)(id, 'id');
            const body = (0, input_1.buildDecisionBody)(o.comment, verb === 'reject');
            const decided = await ApiClient_1.default.post(`${BASE}/${aid}/${verb}`, body);
            (0, cliHelpers_1.emit)(o.json, decided, () => `✓ 审批 #${aid} ${done}` +
                (decided?.selfApproved ? '（⚠ 自批：你是该组织唯一的审批人）' : ''));
        }
        catch (error) {
            (0, cliHelpers_1.fail)(failPrefix, error, input_1.APPROVAL_ERROR_CODES);
        }
    });
    decide(approval.command('approve <id>')
        .description('Approve a pending request (owner/admin, not the requester)')
        .option('--comment <text>', 'Optional comment'), 'approve', '已批准 (approved)', '批准审批失败');
    decide(approval.command('reject <id>')
        .description('Reject a pending request')
        .requiredOption('--comment <text>', 'Why (required)'), 'reject', '已驳回 (rejected)', '驳回审批失败');
    approval
        .command('cancel <id>')
        .description('Cancel a pending request (requester or owner/admin)')
        .option('--json', 'Output as JSON')
        .action(async (id, o) => {
        try {
            const aid = (0, cliHelpers_1.parseId)(id, 'id');
            const cancelled = await ApiClient_1.default.post(`${BASE}/${aid}/cancel`);
            (0, cliHelpers_1.emit)(o.json, cancelled, () => `✓ 审批 #${aid} 已撤销 (cancelled)`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('撤销审批失败', error, input_1.APPROVAL_ERROR_CODES);
        }
    });
}
exports.registerApprovalCommands = registerApprovalCommands;
//# sourceMappingURL=index.js.map