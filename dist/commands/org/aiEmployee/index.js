"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAiEmployeeCommands = exports.renderCapabilities = exports.renderIssuedKey = void 0;
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
const cliHelpers_1 = require("../../../utils/cliHelpers");
const input_1 = require("./input");
/**
 * AI employee key / profile / capability commands (prd-0092 FP-8, FP-9; OrgAiEmployeeController under
 * /api/v1). The raw key exists only in the issue / regenerate response: it is printed once and never stored.
 */
const base = (orgId, id) => `/api/v1/orgs/${orgId}/ai-employees/${id}`;
function renderIssuedKey(employeeId, action, key) {
    return [
        `✓ 已${action === 'issue' ? '签发' : '重新生成'} AI 员工 #${employeeId} 的 Key（前缀 ${(0, cliHelpers_1.dash)(key.keyPrefix)}，状态 ${(0, cliHelpers_1.dash)(key.status)}，创建于 ${(0, cliHelpers_1.fmtDateTime)(key.createdAt)}）`,
        '⚠ 完整 Key 只显示这一次，请立即保存；该员工之前的 Key 已失效。',
        '',
        `  ${(0, cliHelpers_1.dash)(key.rawKey)}`,
        '',
        `在该员工的机器上执行: good7ob config set api-key ${(0, cliHelpers_1.dash)(key.rawKey)}`,
    ].join('\n');
}
exports.renderIssuedKey = renderIssuedKey;
function renderCapabilities(items) {
    if (!items.length)
        return '没有能力目录。';
    const rows = [['代码', '名称', '仅 MANAGER', '说明']].concat(items.map((c) => [(0, cliHelpers_1.dash)(c.code), (0, cliHelpers_1.dash)(c.label), c.managerOnly ? '是' : '否', (0, cliHelpers_1.dash)(c.description)]));
    return (0, cliHelpers_1.renderTable)(rows, { 3: { truncate: 80 } });
}
exports.renderCapabilities = renderCapabilities;
function registerAiEmployeeCommands(orgCommand) {
    const emp = orgCommand
        .command('ai-employee')
        .description('AI employees — CLI/MCP key (issue|regenerate|disable|enable), profile (nickname, role, capabilities), capability catalogue');
    emp
        .command('key <action> <orgId> <employeeId>')
        .description(`Manage the employee's CLI/MCP key: ${input_1.KEY_ACTIONS.join('|')} (owner/admin only). issue / regenerate print the raw key once`)
        .option('--json', 'Output as JSON')
        .action((action, orgId, employeeId, o) => (0, cliHelpers_1.guarded)('操作 AI 员工 Key 失败', input_1.AI_EMPLOYEE_ERROR_CODES, async () => {
        const act = (0, cliHelpers_1.requireOneOf)(String(action).trim().toLowerCase(), input_1.KEY_ACTIONS, 'action');
        const org = (0, cliHelpers_1.parseId)(orgId, 'orgId');
        const id = (0, cliHelpers_1.parseId)(employeeId, 'employeeId');
        if (act === 'issue' || act === 'regenerate') {
            const key = await ApiClient_1.default.post(`${base(org, id)}/key${act === 'regenerate' ? '/regenerate' : ''}`);
            (0, cliHelpers_1.emit)(o.json, key, () => renderIssuedKey(id, act, key ?? {}));
            return;
        }
        const status = act === 'enable' ? 'active' : 'disabled';
        const result = await ApiClient_1.default.patch(`${base(org, id)}/key/status`, { status });
        (0, cliHelpers_1.emit)(o.json, result ?? { status }, () => `✓ AI 员工 #${id} 的 Key 已${act === 'enable' ? '启用' : '停用'}`);
    }));
    emp
        .command('profile <orgId> <employeeId>')
        .description('Update nickname / MCP role / capability scope (at least one option; owner/admin only)')
        .option('--nickname <name>', 'Display name')
        .option('--role <role>', `MCP role (${input_1.MCP_ROLES.join('|')})`)
        .option('--tools <a,b>', 'Capability codes, comma-separated (see `org ai-employee capabilities`); "" clears')
        .option('--products <1,2>', 'Product ids the employee may touch, comma-separated; "" = unrestricted')
        .option('--json', 'Output as JSON')
        .action((orgId, employeeId, o) => (0, cliHelpers_1.guarded)('更新 AI 员工档案失败', input_1.AI_EMPLOYEE_ERROR_CODES, async () => {
        const org = (0, cliHelpers_1.parseId)(orgId, 'orgId');
        const id = (0, cliHelpers_1.parseId)(employeeId, 'employeeId');
        const body = (0, input_1.buildProfileBody)(o);
        const result = await ApiClient_1.default.patch(base(org, id), body);
        (0, cliHelpers_1.emit)(o.json, result ?? body, () => `✓ AI 员工 #${id} 档案已更新: ${Object.keys(body).join(', ')}`);
    }));
    emp
        .command('capabilities <orgId>')
        .description('Capability catalogue: code, label, whether MANAGER-only')
        .option('--json', 'Output as JSON')
        .action((orgId, o) => (0, cliHelpers_1.guarded)('获取能力目录失败', input_1.AI_EMPLOYEE_ERROR_CODES, async () => {
        const org = (0, cliHelpers_1.parseId)(orgId, 'orgId');
        const items = await ApiClient_1.default.get(`/api/v1/orgs/${org}/ai-employees/capabilities`);
        (0, cliHelpers_1.emit)(o.json, items, () => renderCapabilities(Array.isArray(items) ? items : []));
    }));
}
exports.registerAiEmployeeCommands = registerAiEmployeeCommands;
//# sourceMappingURL=index.js.map