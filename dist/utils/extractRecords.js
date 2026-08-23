"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTotal = exports.extractRecords = void 0;
/**
 * 从后端响应中提取列表数据。
 *
 * 后端分页响应的形状并不统一，目前存在四种：
 *   - 裸数组                        `[...]`
 *   - `{ total, list: [...] }`      progress / orgs 等分页接口
 *   - `{ total, records: [...] }`   部分 infra 接口
 *   - `{ members: [...] }`          组织成员接口
 *
 * 各命令此前各自内联判断，写法不一且多数漏掉 `list`，
 * 导致表格视图恒判空。统一走本函数。
 *
 * fix: #4 https://github.com/good7ob/g7b-cli/issues/4
 */
function extractRecords(result) {
    if (Array.isArray(result))
        return result;
    if (!result || typeof result !== 'object')
        return [];
    for (const key of ['list', 'records', 'members', 'items', 'data']) {
        const value = result[key];
        if (Array.isArray(value))
            return value;
    }
    return [];
}
exports.extractRecords = extractRecords;
/**
 * 提取列表总数。分页响应带 `total` 时以它为准（可能大于当前页长度），
 * 否则回落到已提取记录数。
 *
 * fix: #4 https://github.com/good7ob/g7b-cli/issues/4
 */
function extractTotal(result, records) {
    const total = result && typeof result === 'object' ? result.total : undefined;
    if (typeof total === 'number' && Number.isFinite(total))
        return total;
    return (records ?? extractRecords(result)).length;
}
exports.extractTotal = extractTotal;
//# sourceMappingURL=extractRecords.js.map