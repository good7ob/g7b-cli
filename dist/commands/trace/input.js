"use strict";
/**
 * CLI-boundary validation for `trace` commands. Mirrors TraceLinkService: type codes are
 * 2-32 chars of A-Z/0-9/_ (case-insensitive), linkType is one of four, source/target
 * type+id come as pairs, page size is 1..200.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildListParams = exports.buildCreateBody = exports.TRACE_ERROR_CODES = exports.MAX_PAGE_SIZE = exports.LINK_TYPES = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.LINK_TYPES = ['derived_from', 'impacts', 'implements', 'verifies'];
exports.MAX_PAGE_SIZE = 200;
exports.TRACE_ERROR_CODES = {
    1000: '缺少必填参数',
    1001: '参数值不合法（类型代码格式 / linkType / source 与 target 相同 / type 与 id 未成对）',
    1002: '追溯关系 / 产品不存在（或已删除）',
    1006: '追溯关系已存在（同一产品下相同的 source、target、linkType）',
    2000: '无权访问：你不是该产品所属组织的成员',
};
/** Both halves or neither: returns the normalised pair (or undefined when absent). */
function pair(e, name) {
    if (e.type === undefined && e.id === undefined)
        return undefined;
    if (e.type === undefined || e.id === undefined) {
        throw new cliHelpers_1.InputError(`--${name}-type 与 --${name}-id 必须同时提供`);
    }
    return { type: (0, cliHelpers_1.normalizeTypeCode)(e.type, `--${name}-type`), id: (0, cliHelpers_1.parseId)(e.id, `--${name}-id`) };
}
function buildCreateBody(o) {
    const productId = (0, cliHelpers_1.resolveProductId)(o.product);
    const source = pair({ type: o.sourceType, id: o.sourceId }, 'source');
    const target = pair({ type: o.targetType, id: o.targetId }, 'target');
    if (!source || !target)
        throw new cliHelpers_1.InputError('--source-type/--source-id 与 --target-type/--target-id 均为必填');
    if (source.type === target.type && source.id === target.id) {
        throw new cliHelpers_1.InputError('来源和目标不能是同一个对象');
    }
    const linkType = (0, cliHelpers_1.requireOneOf)(o.linkType ?? '', exports.LINK_TYPES, '--link-type');
    return {
        productId, sourceType: source.type, sourceId: source.id, targetType: target.type, targetId: target.id, linkType,
    };
}
exports.buildCreateBody = buildCreateBody;
function buildListParams(o) {
    const params = {
        productId: (0, cliHelpers_1.resolveProductId)(o.product),
        pageNum: (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000),
        pageSize: (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '50', '--page-size', 1, exports.MAX_PAGE_SIZE),
    };
    const source = pair({ type: o.sourceType, id: o.sourceId }, 'source');
    const target = pair({ type: o.targetType, id: o.targetId }, 'target');
    if (source)
        Object.assign(params, { sourceType: source.type, sourceId: source.id });
    if (target)
        Object.assign(params, { targetType: target.type, targetId: target.id });
    if (o.linkType !== undefined)
        params.linkType = (0, cliHelpers_1.requireOneOf)(o.linkType, exports.LINK_TYPES, '--link-type');
    return params;
}
exports.buildListParams = buildListParams;
//# sourceMappingURL=input.js.map