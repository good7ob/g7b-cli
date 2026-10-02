"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWhoamiCommands = exports.renderActor = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const list = (values, empty) => (values?.length ? values.join(', ') : empty);
function renderActor(a) {
    const e = a.employee;
    const lines = [
        `身份:     ${(0, cliHelpers_1.dash)(a.actorType)}${e ? '（AI 员工）' : a.actorType === 'USER' ? '（人类用户）' : ''}`,
        `用户 ID:  ${(0, cliHelpers_1.dash)(a.userId)}${e ? '（签发人，数据权限沿用其组织身份）' : ''}`,
        `渠道:     ${(0, cliHelpers_1.dash)(a.channel)}`,
    ];
    if (e) {
        lines.push('AI 员工:', `  ID:     ${(0, cliHelpers_1.dash)(e.id)}`, `  昵称:   ${(0, cliHelpers_1.dash)(e.nickname)}`, `  组织:   ${(0, cliHelpers_1.dash)(e.orgId)}`, `  角色:   ${(0, cliHelpers_1.dash)(e.mcpRole)}`, `  能力:   ${list(e.capabilityScope?.tools, '（无）')}`, `  产品:   ${list(e.capabilityScope?.productIds, '不限')}`);
    }
    return lines.join('\n');
}
exports.renderActor = renderActor;
function registerWhoamiCommands(program) {
    program
        .command('whoami')
        .description('Who the configured API key acts as: a user, or an AI employee (id, nickname, org, role, capabilities)')
        .option('--json', 'Output as JSON')
        .action((o) => (0, cliHelpers_1.guarded)('获取当前身份失败', {}, async () => {
        const actor = await ApiClient_1.default.get('/api/v1/me/actor');
        (0, cliHelpers_1.emit)(o.json, actor, () => renderActor(actor ?? {}));
    }));
}
exports.registerWhoamiCommands = registerWhoamiCommands;
//# sourceMappingURL=index.js.map