"use strict";
/**
 * CLI-boundary validation for template versions, dependencies, reviews and admin decisions.
 * Limits mirror TemplateVersionService / TemplateDependencyService / TemplateReviewService / TemplateModerationService.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildModerationBody = exports.buildReviewBody = exports.buildDependency = exports.loadDependencies = exports.buildVersionUpdateBody = exports.buildVersionAddBody = exports.loadPayload = exports.requireSemver = exports.DEPENDENCY_KINDS = exports.MAX_DEPENDENCIES = exports.MAX_COMMENT = exports.MAX_CHANGELOG = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const jsonInput_1 = require("./jsonInput");
const SEMVER = /^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}$/;
exports.MAX_CHANGELOG = 5000;
exports.MAX_COMMENT = 1000;
exports.MAX_DEPENDENCIES = 20;
exports.DEPENDENCY_KINDS = ['requires', 'optional'];
/** `x.y.z`, each part 1-6 digits (the server compares numerically: 1.10.0 > 1.9.0). */
function requireSemver(raw, label) {
    const text = (raw ?? '').trim();
    if (!SEMVER.test(text))
        throw new cliHelpers_1.InputError(`${label} 必须是 x.y.z 格式的版本号（如 1.0.0），收到: ${raw === undefined ? '(空)' : raw}`);
    return text;
}
exports.requireSemver = requireSemver;
/** Load + guard every JSON piece the user supplied (nothing is sent before all of them pass). */
function loadPayload(o) {
    const content = (0, jsonInput_1.loadJson)({ file: o.contentFile, inline: o.content }, '--content-file', '--content', 'content');
    const variables = (0, jsonInput_1.loadJson)({ file: o.variablesFile }, '--variables-file', '--variables-file', 'variables');
    const compatibility = (0, jsonInput_1.loadJson)({ file: o.compatibilityFile }, '--compatibility-file', '--compatibility-file', 'compatibility');
    const payload = {};
    if (o.changelog !== undefined)
        payload.changelog = (0, cliHelpers_1.checkMaxLength)(o.changelog, exports.MAX_CHANGELOG, '--changelog');
    if (content !== undefined)
        payload.content = (0, jsonInput_1.checkContent)(content);
    if (variables !== undefined)
        payload.variables = (0, jsonInput_1.checkVariables)(variables);
    if (compatibility !== undefined)
        payload.compatibility = (0, jsonInput_1.checkCompatibility)(compatibility);
    return payload;
}
exports.loadPayload = loadPayload;
function buildVersionAddBody(o) {
    const version = requireSemver(o.version, '--version');
    const payload = loadPayload(o);
    if (payload.content === undefined)
        throw new cliHelpers_1.InputError('缺少内容：用 --content-file <file.json> 或 --content \'<json>\' 提供 content');
    return { version, ...payload };
}
exports.buildVersionAddBody = buildVersionAddBody;
/** Omitted flag = field unchanged; content and variables are re-validated together by the server. */
function buildVersionUpdateBody(o) {
    const payload = loadPayload(o);
    if (Object.keys(payload).length === 0) {
        throw new cliHelpers_1.InputError('没有要修改的字段：至少指定 --changelog / --content-file / --content / --variables-file / --compatibility-file 之一');
    }
    return { ...payload };
}
exports.buildVersionUpdateBody = buildVersionUpdateBody;
/** deps.json: an array, or `{ "dependencies": [...] }`; each `{requiredTemplateId, minVersion?, kind?}`. */
function loadDependencies(file) {
    const parsed = (0, jsonInput_1.parseJsonText)((0, jsonInput_1.readJsonFile)(file, '--file'), 'dependencies');
    const list = Array.isArray(parsed) ? parsed : parsed?.dependencies;
    if (!Array.isArray(list))
        throw new cliHelpers_1.InputError('dependencies: 文件必须是数组，或形如 {"dependencies": [...]} 的对象');
    if (list.length > exports.MAX_DEPENDENCIES)
        throw new cliHelpers_1.InputError(`dependencies: 最多 ${exports.MAX_DEPENDENCIES} 个，当前 ${list.length} 个`);
    const entries = list.map((item, i) => parseDependency(item, `dependencies[${i}]`));
    const ids = entries.map((e) => e.requiredTemplateId);
    if (new Set(ids).size !== ids.length)
        throw new cliHelpers_1.InputError('dependencies: requiredTemplateId 不能重复');
    return entries;
}
exports.loadDependencies = loadDependencies;
function parseDependency(item, at) {
    if (item === null || typeof item !== 'object' || Array.isArray(item))
        throw new cliHelpers_1.InputError(`${at}: 必须是对象`);
    const raw = item;
    const extra = Object.keys(raw).filter((k) => !['requiredTemplateId', 'minVersion', 'kind'].includes(k));
    if (extra.length)
        throw new cliHelpers_1.InputError(`${at}: 不支持的字段 ${extra.join(', ')}（可用: requiredTemplateId, minVersion, kind）`);
    const text = (v) => (v === undefined || v === null ? undefined : String(v));
    return buildDependency({ template: text(raw.requiredTemplateId), minVersion: text(raw.minVersion), kind: text(raw.kind) }, { template: `${at}.requiredTemplateId`, minVersion: `${at}.minVersion`, kind: `${at}.kind` });
}
const FLAG_LABELS = { template: '--template', minVersion: '--min-version', kind: '--kind' };
function buildDependency(o, labels = FLAG_LABELS) {
    const dep = { requiredTemplateId: (0, cliHelpers_1.parseId)(o.template, labels.template) };
    if (o.minVersion !== undefined)
        dep.minVersion = requireSemver(o.minVersion, labels.minVersion);
    if (o.kind !== undefined)
        dep.kind = (0, cliHelpers_1.requireOneOf)(o.kind.trim().toLowerCase(), exports.DEPENDENCY_KINDS, labels.kind);
    return dep;
}
exports.buildDependency = buildDependency;
function buildReviewBody(o) {
    const body = { rating: (0, cliHelpers_1.parseIntInRange)(o.rating ?? '', '--rating', 1, 5) };
    if (o.comment !== undefined)
        body.comment = (0, cliHelpers_1.checkMaxLength)(o.comment, exports.MAX_COMMENT, '--comment');
    return body;
}
exports.buildReviewBody = buildReviewBody;
/** Admin decision note: `required` for reject / suspend, optional (may be omitted) for approve / unsuspend. */
function buildModerationBody(raw, flag, required) {
    if (required)
        return { comment: (0, cliHelpers_1.requireText)(raw, exports.MAX_COMMENT, flag) };
    return raw === undefined ? {} : { comment: (0, cliHelpers_1.checkMaxLength)(raw, exports.MAX_COMMENT, flag) };
}
exports.buildModerationBody = buildModerationBody;
//# sourceMappingURL=versionInput.js.map