"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDiff = exports.renderVersionList = exports.renderVersion = exports.renderVersionHeader = exports.renderDependencyList = exports.renderDependencies = exports.renderVariables = exports.renderContent = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const extractRecords_1 = require("../../utils/extractRecords");
/** Content can be up to 1 MB: show the head in a terminal, the whole thing is in `--json`. */
const CONTENT_LINES = 60;
/** `content` is untrusted user text (api-0091 §1): printed as text only, control characters are stripped by `emit`. */
function renderContent(content) {
    if (content === null || content === undefined)
        return [`内容: ${cliHelpers_1.DASH}`];
    const lines = JSON.stringify(content, null, 2).split('\n');
    const shown = lines.slice(0, CONTENT_LINES);
    if (lines.length > CONTENT_LINES)
        shown.push(`… 共 ${lines.length} 行，已省略 ${lines.length - CONTENT_LINES} 行（完整内容用 --json）`);
    return ['内容:', ...shown];
}
exports.renderContent = renderContent;
function renderVariables(variables) {
    if (!variables?.length)
        return [`变量: ${cliHelpers_1.DASH}`];
    const rows = [['名称', '类型', '必填', '默认值', '标签']].concat(variables.map((v) => [(0, cliHelpers_1.dash)(v.name), (0, cliHelpers_1.dash)(v.type), v.required ? '是' : '否', (0, cliHelpers_1.dash)(v.default), (0, cliHelpers_1.dash)(v.label)]));
    return [`变量 (${variables.length})`, (0, cliHelpers_1.renderTable)(rows, { 3: { truncate: 30 }, 4: { truncate: 30 } })];
}
exports.renderVariables = renderVariables;
function renderDependencies(deps) {
    if (!deps?.length)
        return [`依赖: ${cliHelpers_1.DASH}`];
    const rows = [['ID', '被依赖模板', '名称', '最低版本', '类型']].concat(deps.map((d) => [(0, cliHelpers_1.dash)(d.id), `#${(0, cliHelpers_1.dash)(d.requiredTemplateId)}`, (0, cliHelpers_1.dash)(d.requiredTemplateName), (0, cliHelpers_1.dash)(d.minVersion), (0, cliHelpers_1.dash)(d.kind)]));
    return [`依赖 (${deps.length})`, (0, cliHelpers_1.renderTable)(rows)];
}
exports.renderDependencies = renderDependencies;
function renderDependencyList(result) {
    return renderDependencies((0, extractRecords_1.extractRecords)(result)).join('\n');
}
exports.renderDependencyList = renderDependencyList;
function reviewLine(v) {
    if (!v.reviewResult && !v.reviewComment)
        return [];
    const by = v.reviewedBy ? ` by ${v.reviewedBy}` : '';
    return [`审核:     ${(0, cliHelpers_1.dash)(v.reviewResult)}${by} @ ${(0, cliHelpers_1.fmtDateTime)(v.reviewedAt)}${v.reviewComment ? ` — ${v.reviewComment}` : ''}`];
}
function renderVersionHeader(v) {
    return [
        `版本 ${(0, cliHelpers_1.dash)(v.version)}  [${(0, cliHelpers_1.dash)(v.status)}]  (id ${(0, cliHelpers_1.dash)(v.id)}, 模板 #${(0, cliHelpers_1.dash)(v.templateId)})`,
        `时间:     提交 ${(0, cliHelpers_1.fmtDateTime)(v.submittedAt)}    发布 ${(0, cliHelpers_1.fmtDateTime)(v.publishedAt)}    创建 ${(0, cliHelpers_1.fmtDateTime)(v.createdAt)} by ${(0, cliHelpers_1.dash)(v.createdBy)}`,
        `上一版本: ${v.previousVersionId ? `#${v.previousVersionId}` : cliHelpers_1.DASH}`,
        ...reviewLine(v),
        ...(v.changelog ? [`变更说明: ${v.changelog}`] : []),
    ];
}
exports.renderVersionHeader = renderVersionHeader;
function renderVersion(v) {
    return [
        ...renderVersionHeader(v),
        '',
        ...renderVariables(v.variables),
        '',
        ...renderDependencies(v.dependencies),
        '',
        ...renderContent(v.content),
    ].join('\n');
}
exports.renderVersion = renderVersion;
/** The list endpoint carries no content / variables / dependencies. */
function renderVersionList(result) {
    const records = (0, extractRecords_1.extractRecords)(result);
    if (!records.length)
        return '没有可见的版本。';
    const rows = [['版本', '状态', '审核', '提交', '发布', '变更说明']].concat(records.map((v) => [
        (0, cliHelpers_1.dash)(v.version), (0, cliHelpers_1.dash)(v.status), (0, cliHelpers_1.dash)(v.reviewResult), (0, cliHelpers_1.fmtDateTime)(v.submittedAt), (0, cliHelpers_1.fmtDateTime)(v.publishedAt), (0, cliHelpers_1.dash)(v.changelog),
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 5: { truncate: 40 } })}\n共 ${records.length} 个版本`;
}
exports.renderVersionList = renderVersionList;
function diffSection(title, set) {
    const added = set?.added ?? [];
    const changed = set?.changed ?? [];
    const removed = set?.removed ?? [];
    if (!added.length && !changed.length && !removed.length)
        return [`${title}: 无差异`];
    return [
        `${title}  (+${added.length} ~${changed.length} -${removed.length})`,
        ...added.map((e) => `  + ${(0, cliHelpers_1.dash)(e.path)}: ${(0, cliHelpers_1.dash)(e.to)}`),
        ...changed.map((e) => `  ~ ${(0, cliHelpers_1.dash)(e.path)}: ${(0, cliHelpers_1.dash)(e.from)} → ${(0, cliHelpers_1.dash)(e.to)}`),
        ...removed.map((e) => `  - ${(0, cliHelpers_1.dash)(e.path)}: ${(0, cliHelpers_1.dash)(e.from)}`),
    ];
}
function renderDiff(d) {
    return [
        `版本差异 ${(0, cliHelpers_1.dash)(d.from)} → ${(0, cliHelpers_1.dash)(d.to)}${d.identical ? '（完全相同）' : ''}`,
        ...(d.truncated ? ['⚠ 差异过多，结果已截断（每类最多 200 条，文本最多 500 字符）'] : []),
        ...diffSection('内容', d.content),
        ...diffSection('变量', d.variables),
    ].join('\n');
}
exports.renderDiff = renderDiff;
//# sourceMappingURL=renderVersion.js.map