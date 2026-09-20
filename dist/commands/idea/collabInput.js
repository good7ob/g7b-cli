"use strict";
/**
 * CLI-boundary validation for the collaboration commands (comment / attachment / tag / relation /
 * merge / duplicates). Limits mirror IdeaCommentDto / IdeaAttachmentDto / IdeaTagService /
 * IdeaRelationDto / IdeaMergeDto; the attachment address check mirrors IdeaAttachmentStorageGuard.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDuplicatesParams = exports.buildMergeBody = exports.buildRelationBody = exports.buildTagsBody = exports.buildAttachmentBody = exports.checkFileUrl = exports.buildCommentListParams = exports.buildCommentBody = exports.MAX_DUPLICATES = exports.MAX_FILE_BYTES = exports.MAX_CONTENT_TYPE = exports.MAX_FILE_URL = exports.MAX_FILE_NAME = exports.MAX_COMMENT = exports.MAX_TAGS = exports.RELATION_TYPES = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("./input");
exports.RELATION_TYPES = ['related', 'duplicate_of', 'blocks'];
exports.MAX_TAGS = 10;
exports.MAX_COMMENT = 2000;
exports.MAX_FILE_NAME = 255;
exports.MAX_FILE_URL = 1000;
exports.MAX_CONTENT_TYPE = 100;
exports.MAX_FILE_BYTES = 20 * 1024 * 1024;
exports.MAX_DUPLICATES = 20;
function buildCommentBody(o) {
    const body = { content: (0, cliHelpers_1.requireText)(o.text, exports.MAX_COMMENT, '--text') };
    if (o.parent !== undefined)
        body.parentId = (0, cliHelpers_1.parseId)(o.parent, '--parent');
    return body;
}
exports.buildCommentBody = buildCommentBody;
function buildCommentListParams(o) {
    return {
        pageNum: (0, cliHelpers_1.parseIntInRange)(o.page ?? '1', '--page', 1, 1000000),
        pageSize: (0, cliHelpers_1.parseIntInRange)(o.pageSize ?? '20', '--page-size', 1, input_1.MAX_PAGE_SIZE),
    };
}
exports.buildCommentListParams = buildCommentListParams;
// bucket.s3.amazonaws.com | bucket.s3.<region>.amazonaws.com | bucket.s3-<region>.amazonaws.com
const S3_HOST = /^[a-z0-9][a-z0-9.-]*\.s3([.-][a-z0-9-]+)?\.amazonaws\.com$/i;
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/;
function isDotSegment(segment) {
    let decoded = segment;
    try {
        decoded = decodeURIComponent(segment);
    }
    catch {
        // an undecodable segment can't be a dot segment; the server still validates the rest
    }
    return decoded === '' || decoded === '.' || decoded === '..';
}
/**
 * The shape the backend accepts: https, an S3 host, a path under /public/, no query / fragment /
 * userinfo / path traversal. The bucket name itself is server config, so only the shape is checked.
 */
function checkFileUrl(raw) {
    const url = (0, cliHelpers_1.requireText)(raw, exports.MAX_FILE_URL, '--url').trim();
    const m = /^https:\/\/([^/?#@\s]+)(\/[^?#\s]*)$/i.exec(url);
    const bad = () => new cliHelpers_1.InputError(`--url 必须是项目存储内 /public/ 下的文件地址（https://<bucket>.s3.<region>.amazonaws.com/public/...，不含查询串 / # / 用户信息），收到: ${url}`);
    if (!m || !S3_HOST.test(m[1]) || !m[2].startsWith('/public/') || m[2] === '/public/')
        throw bad();
    if (m[2].slice(1).split('/').some(isDotSegment))
        throw bad();
    return url;
}
exports.checkFileUrl = checkFileUrl;
function buildAttachmentBody(o) {
    const body = {
        fileName: (0, cliHelpers_1.requireText)(o.name, exports.MAX_FILE_NAME, '--name'),
        fileUrl: checkFileUrl(o.url),
        sizeBytes: (0, cliHelpers_1.parseIntInRange)(o.size ?? '', '--size', 0, exports.MAX_FILE_BYTES),
    };
    if (o.contentType !== undefined)
        body.contentType = (0, cliHelpers_1.checkMaxLength)(o.contentType, exports.MAX_CONTENT_TYPE, '--content-type');
    return body;
}
exports.buildAttachmentBody = buildAttachmentBody;
/**
 * `a,b,c` -> trimmed, lower-cased, de-duplicated (what the server stores anyway). An empty
 * string clears the tags.
 */
function buildTagsBody(raw) {
    if (raw === undefined)
        throw new cliHelpers_1.InputError('--tags 不能缺省（逗号分隔；传空字符串 "" 表示清空）');
    if (!raw.trim())
        return { tags: [] };
    const tags = Array.from(new Set(raw.split(',').map((t) => t.trim().toLowerCase())));
    tags.forEach((tag) => {
        if (!tag || tag.length > input_1.MAX_TAG_LENGTH || CONTROL_CHARS.test(tag)) {
            throw new cliHelpers_1.InputError(`--tags 每项必须是 1~${input_1.MAX_TAG_LENGTH} 个字符且不含控制字符，收到: ${tag || '(空)'}`);
        }
    });
    if (tags.length > exports.MAX_TAGS)
        throw new cliHelpers_1.InputError(`--tags 去重后最多 ${exports.MAX_TAGS} 个，当前 ${tags.length} 个`);
    return { tags };
}
exports.buildTagsBody = buildTagsBody;
function buildRelationBody(ideaId, o) {
    const relatedIdeaId = (0, cliHelpers_1.parseId)(o.to, '--to');
    if (relatedIdeaId === ideaId)
        throw new cliHelpers_1.InputError('--to 不能是 Idea 自身（不允许自关联）');
    return { relatedIdeaId, relationType: (0, cliHelpers_1.requireOneOf)(o.type ?? '', exports.RELATION_TYPES, '--type') };
}
exports.buildRelationBody = buildRelationBody;
function buildMergeBody(ideaId, into) {
    const targetIdeaId = (0, cliHelpers_1.parseId)(into, '--into');
    if (targetIdeaId === ideaId)
        throw new cliHelpers_1.InputError('--into 不能是 Idea 自身');
    return { targetIdeaId };
}
exports.buildMergeBody = buildMergeBody;
function buildDuplicatesParams(limit) {
    return limit === undefined ? undefined : { limit: (0, cliHelpers_1.parseIntInRange)(limit, '--limit', 1, exports.MAX_DUPLICATES) };
}
exports.buildDuplicatesParams = buildDuplicatesParams;
//# sourceMappingURL=collabInput.js.map