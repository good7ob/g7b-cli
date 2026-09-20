"use strict";
/**
 * CLI-boundary validation for `template` commands. Enums and limits mirror the backend
 * (com.remostudio.template: TemplateType, TemplateRules, TemplateTagService, TemplateSearchDto) so a bad
 * value is rejected here with a clear message instead of as a 1001 round-trip.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildUpdateBody = exports.buildCreateBody = exports.buildTagsParams = exports.buildListParams = exports.buildSearchRequest = exports.parseTags = exports.pageParams = exports.upperOneOf = exports.TEMPLATE_ERROR_CODES = exports.oneOf = exports.MAX_PAGE_SIZE = exports.MAX_TAG_LENGTH = exports.MAX_TAGS = exports.MAX_DESCRIPTION = exports.MAX_NAME = exports.TAG_KINDS = exports.SORTS = exports.PRICINGS = exports.LICENSES = exports.STATUSES = exports.VISIBILITIES = exports.TEMPLATE_TYPES = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const versionInput_1 = require("./versionInput");
exports.TEMPLATE_TYPES = [
    'PRD', 'PROJECT', 'TASK', 'UI', 'API', 'DB', 'TEST', 'ARCH', 'AI_PROMPT', 'AGENT_SKILL', 'WORKFLOW', 'RELEASE',
];
exports.VISIBILITIES = ['PUBLIC', 'ORGANIZATION', 'PRIVATE'];
exports.STATUSES = ['DRAFT', 'REVIEWING', 'REJECTED', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED'];
exports.LICENSES = ['PERSONAL', 'ORGANIZATION', 'COMMERCIAL', 'ENTERPRISE'];
exports.PRICINGS = ['FREE', 'ONE_TIME', 'SUBSCRIPTION', 'PRIVATE'];
exports.SORTS = ['latest', 'popular', 'rating', 'installs'];
exports.TAG_KINDS = ['GENERAL', 'INDUSTRY', 'TECH_STACK', 'LANGUAGE', 'PLATFORM'];
exports.MAX_NAME = 100;
exports.MAX_DESCRIPTION = 2000;
exports.MAX_TAGS = 10;
exports.MAX_TAG_LENGTH = 30;
exports.MAX_PAGE_SIZE = 50;
const oneOf = (values) => values.join('|');
exports.oneOf = oneOf;
exports.TEMPLATE_ERROR_CODES = {
    1000: '缺少必填参数',
    1001: '参数值不合法（消息里带 JSON 路径时指内容 / 变量校验失败）',
    1002: '模板 / 版本 / 包 / 分类不存在，或对你不可见（私有模板不可见时同样返回不存在）',
    1003: '商业化未开放：目前只能创建免费模板（不支持非 FREE 定价、价格 > 0、订阅计划）',
    1006: '数据已存在：同名模板 / 版本号重复 / 依赖或包条目重复 / 已评价过',
    1007: '当前状态不允许该操作（归档 / 下架 / 审核中不可改；版本不是 DRAFT；已有版本在审核中；模板已有实例不可删除）',
    1009: '已被处理或并发冲突（例如版本已被别的管理员批准 / 驳回），请刷新后重试',
    2000: '无权限：可见但不可管理 / 非组织 owner 或 admin / 未安装使用就评价 / 评价自己的模板 / 非平台管理员',
};
/** Case-insensitive enum (the server upper-cases too); returns the canonical upper-case value. */
function upperOneOf(raw, allowed, label) {
    return (0, cliHelpers_1.requireOneOf)(String(raw).trim().toUpperCase(), allowed, label);
}
exports.upperOneOf = upperOneOf;
function pageParams(o) {
    return {
        pageNum: (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000),
        pageSize: (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '20', '--page-size', 1, exports.MAX_PAGE_SIZE),
    };
}
exports.pageParams = pageParams;
/** `a,b,c` -> ['a','b','c']: trimmed, blanks dropped, case-insensitively de-duplicated, <=10 names of 1-30 chars. */
function parseTags(raw, flag = '--tags') {
    const seen = new Set();
    const tags = [];
    raw.split(',').map((t) => t.trim()).filter(Boolean).forEach((tag) => {
        (0, cliHelpers_1.checkMaxLength)(tag, exports.MAX_TAG_LENGTH, `${flag} 的标签 "${tag.slice(0, 10)}…"`);
        if (!seen.has(tag.toLowerCase())) {
            seen.add(tag.toLowerCase());
            tags.push(tag);
        }
    });
    if (tags.length > exports.MAX_TAGS)
        throw new cliHelpers_1.InputError(`${flag} 最多 ${exports.MAX_TAGS} 个标签，当前 ${tags.length} 个`);
    return tags;
}
exports.parseTags = parseTags;
function parseMinRating(raw) {
    const text = String(raw).trim();
    const value = Number(text);
    if (!/^[0-9]+(\.[0-9]+)?$/.test(text) || value > 5) {
        throw new cliHelpers_1.InputError(`--min-rating 必须在 0 到 5 之间，收到: ${raw}`);
    }
    return value;
}
/**
 * GET /templates request. `tag` may repeat (all must match), and axios would serialise an array as `tag[]=…`
 * which Spring does not bind, so the tags go into the URL as plain repeated `tag=` pairs.
 */
function buildSearchRequest(o) {
    const params = pageParams(o);
    if (o.keyword?.trim())
        params.keyword = o.keyword.trim();
    if (o.type !== undefined)
        params.type = upperOneOf(o.type, exports.TEMPLATE_TYPES, '--type');
    if (o.category !== undefined)
        params.categoryId = (0, cliHelpers_1.parseId)(o.category, '--category');
    if (o.industry !== undefined)
        params.industry = (0, cliHelpers_1.requireText)(o.industry, exports.MAX_TAG_LENGTH, '--industry');
    if (o.techStack !== undefined)
        params.techStack = (0, cliHelpers_1.requireText)(o.techStack, exports.MAX_TAG_LENGTH, '--tech-stack');
    if (o.language !== undefined)
        params.language = (0, cliHelpers_1.requireText)(o.language, exports.MAX_TAG_LENGTH, '--language');
    if (o.platform !== undefined)
        params.platform = (0, cliHelpers_1.requireText)(o.platform, exports.MAX_TAG_LENGTH, '--platform');
    if (o.pricing !== undefined)
        params.pricingType = upperOneOf(o.pricing, exports.PRICINGS, '--pricing');
    if (o.minRating !== undefined)
        params.minRating = parseMinRating(o.minRating);
    if (o.author !== undefined)
        params.authorId = (0, cliHelpers_1.parseId)(o.author, '--author');
    if (o.official !== undefined)
        params.official = o.official;
    if (o.sort !== undefined)
        params.sort = (0, cliHelpers_1.requireOneOf)(o.sort.trim().toLowerCase(), exports.SORTS, '--sort');
    const tags = (o.tag ?? []).map((t) => (0, cliHelpers_1.requireText)(t, exports.MAX_TAG_LENGTH, '--tag'));
    if (tags.length > exports.MAX_TAGS)
        throw new cliHelpers_1.InputError(`--tag 最多 ${exports.MAX_TAGS} 个，当前 ${tags.length} 个`);
    const query = tags.map((t) => `tag=${encodeURIComponent(t)}`).join('&');
    return { url: query ? `/templates?${query}` : '/templates', params };
}
exports.buildSearchRequest = buildSearchRequest;
/** `mine` / `org`: optional status + type filters and paging. */
function buildListParams(o) {
    const params = pageParams(o);
    if (o.status !== undefined)
        params.status = upperOneOf(o.status, exports.STATUSES, '--status');
    if (o.type !== undefined)
        params.type = upperOneOf(o.type, exports.TEMPLATE_TYPES, '--type');
    return params;
}
exports.buildListParams = buildListParams;
function buildTagsParams(o) {
    const params = {};
    if (o.kind !== undefined)
        params.kind = upperOneOf(o.kind, exports.TAG_KINDS, '--kind');
    if (o.keyword?.trim())
        params.keyword = o.keyword.trim();
    if (o.limit !== undefined)
        params.limit = (0, cliHelpers_1.parseIntInRange)(o.limit, '--limit', 1, 100);
    return params;
}
exports.buildTagsParams = buildTagsParams;
function applyMeta(body, o) {
    if (o.description !== undefined)
        body.description = (0, cliHelpers_1.checkMaxLength)(o.description, exports.MAX_DESCRIPTION, '--description');
    if (o.category !== undefined)
        body.categoryId = (0, cliHelpers_1.parseId)(o.category, '--category');
    if (o.visibility !== undefined)
        body.visibility = upperOneOf(o.visibility, exports.VISIBILITIES, '--visibility');
    if (o.tags !== undefined)
        body.tags = parseTags(o.tags);
    if (o.license !== undefined)
        body.licenseType = upperOneOf(o.license, exports.LICENSES, '--license');
}
/** Content / variables for a first version: `version` and `variables` without `content` are rejected by the server (1001). */
function applyFirstVersion(body, o) {
    const payload = (0, versionInput_1.loadPayload)(o);
    if (payload.content === undefined) {
        if (o.version !== undefined || o.changelog !== undefined || payload.variables !== undefined || payload.compatibility !== undefined) {
            throw new cliHelpers_1.InputError('--version / --changelog / --variables-file / --compatibility-file 需要同时提供 --content-file 或 --content（否则不会创建版本）');
        }
        return;
    }
    Object.assign(body, payload);
    if (o.version !== undefined)
        body.version = (0, versionInput_1.requireSemver)(o.version, '--version');
}
function buildCreateBody(o) {
    const body = {
        name: (0, cliHelpers_1.requireText)(o.name, exports.MAX_NAME, '--name').trim(),
        templateType: upperOneOf(o.type ?? '', exports.TEMPLATE_TYPES, '--type'),
    };
    applyMeta(body, o);
    if (o.org !== undefined)
        body.orgId = (0, cliHelpers_1.parseId)(o.org, '--org');
    if (body.visibility === 'ORGANIZATION' && body.orgId === undefined) {
        throw new cliHelpers_1.InputError('--visibility ORGANIZATION 只适用于组织模板：请同时指定 --org <orgId>');
    }
    applyFirstVersion(body, o);
    return body;
}
exports.buildCreateBody = buildCreateBody;
/** Omitted flag = field unchanged (backend contract), so only send what was given. */
function buildUpdateBody(o) {
    const body = {};
    if (o.name !== undefined)
        body.name = (0, cliHelpers_1.requireText)(o.name, exports.MAX_NAME, '--name').trim();
    applyMeta(body, o);
    if (o.tags !== undefined && o.clearTags)
        throw new cliHelpers_1.InputError('--tags 与 --clear-tags 不能同时使用');
    if (o.clearTags)
        body.tags = [];
    if (o.resubmitForReview)
        body.resubmitForReview = true;
    if (Object.keys(body).length === 0) {
        throw new cliHelpers_1.InputError('没有要修改的字段：至少指定 --name / --description / --category / --visibility / --tags / --clear-tags / --license / --resubmit-for-review 之一');
    }
    return body;
}
exports.buildUpdateBody = buildUpdateBody;
//# sourceMappingURL=input.js.map