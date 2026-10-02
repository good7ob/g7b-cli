"use strict";
/**
 * CLI-boundary validation for `org ai-employee` (prd-0092 FP-8 / FP-9, api-0092): key actions,
 * the profile PATCH body (only the fields given are sent) and the shared error map.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProfileBody = exports.AI_EMPLOYEE_ERROR_CODES = exports.MAX_PRODUCTS = exports.MAX_NICKNAME = exports.MCP_ROLES = exports.KEY_ACTIONS = void 0;
const cliHelpers_1 = require("../../../utils/cliHelpers");
exports.KEY_ACTIONS = ['issue', 'regenerate', 'disable', 'enable'];
exports.MCP_ROLES = ['VIEWER', 'DEVELOPER', 'MANAGER'];
exports.MAX_NICKNAME = 50;
exports.MAX_PRODUCTS = 100;
exports.AI_EMPLOYEE_ERROR_CODES = {
    1000: '缺少必填参数',
    1001: '参数值不合法（角色 / 能力项未知、产品不属于该组织、昵称超长）',
    1002: '组织或 AI 员工不存在，或不属于你',
    1007: '当前状态不允许该操作（员工已停用 / Key 已吊销）',
    2000: '该 AI 员工无权执行此操作或你不是组织 owner/admin',
};
/** `a,b` -> ['a','b'] trimmed and de-duplicated; an empty string means "clear" (`[]`). */
const csv = (raw) => Array.from(new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)));
function buildProfileBody(o) {
    if (o.nickname === undefined && o.role === undefined && o.tools === undefined && o.products === undefined) {
        throw new cliHelpers_1.InputError('至少指定一项: --nickname / --role / --tools / --products');
    }
    const body = {};
    if (o.nickname !== undefined)
        body.nickname = (0, cliHelpers_1.requireText)(o.nickname.trim(), exports.MAX_NICKNAME, '--nickname');
    if (o.role !== undefined)
        body.mcpRole = (0, cliHelpers_1.requireOneOf)(o.role.trim().toUpperCase(), exports.MCP_ROLES, '--role');
    const scope = {};
    if (o.tools !== undefined) {
        scope.tools = csv(o.tools).map((t) => {
            if (!/^[a-z][a-z0-9_]{1,63}$/i.test(t))
                throw new cliHelpers_1.InputError(`--tools 的每一项必须是能力代码（如 task_read），收到: ${t}`);
            return (0, cliHelpers_1.checkMaxLength)(t, 64, '--tools');
        });
    }
    if (o.products !== undefined) {
        scope.productIds = Array.from(new Set(csv(o.products).map((p) => (0, cliHelpers_1.parseId)(p, '--products 的每一项'))));
        if (scope.productIds.length > exports.MAX_PRODUCTS)
            throw new cliHelpers_1.InputError(`--products 最多 ${exports.MAX_PRODUCTS} 个`);
    }
    if (o.tools !== undefined || o.products !== undefined)
        body.capabilityScope = scope;
    return body;
}
exports.buildProfileBody = buildProfileBody;
//# sourceMappingURL=input.js.map