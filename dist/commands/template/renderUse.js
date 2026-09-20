"use strict";
/**
 * Renderers for installs, instances and package instantiation. Every value may be null (the backend drops null
 * fields), shown as "—"; rendered content is untrusted user text: printed as text only (`emit` strips control chars).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderInstalledList = exports.renderInstalled = exports.renderPackageInstantiation = exports.renderInstanceList = exports.renderInstance = exports.renderInstantiated = exports.renderCreatedObjects = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const extractRecords_1 = require("../../utils/extractRecords");
const render_1 = require("./render");
const renderCheck_1 = require("./renderCheck");
const renderBody_1 = require("./renderBody");
/** Long object lists (a task template makes up to 200) are cut in a terminal; `--json` has all of them. */
const OBJECT_ROWS = 60;
const scope = (orgId) => (orgId ? `组织 #${orgId}` : '个人范围');
const warningLines = (warnings) => (warnings ?? []).map((w) => `⚠ ${w}`);
function renderCreatedObjects(objects) {
    const list = objects ?? [];
    if (!list.length)
        return [`创建的对象: ${cliHelpers_1.DASH}`];
    const rows = [['类型', 'ID', '名称', '引用']].concat(list.slice(0, OBJECT_ROWS).map((o) => [(0, cliHelpers_1.dash)(o.type), (0, cliHelpers_1.dash)(o.id), (0, cliHelpers_1.dash)(o.name), (0, cliHelpers_1.dash)(o.ref)]));
    const more = list.length > OBJECT_ROWS ? [`… 共 ${list.length} 个，已省略 ${list.length - OBJECT_ROWS} 个（完整列表用 --json）`] : [];
    return [`创建的对象 (${list.length})`, (0, cliHelpers_1.renderTable)(rows, { 2: { truncate: 50 } }), ...more];
}
exports.renderCreatedObjects = renderCreatedObjects;
function renderVariableValues(variables) {
    const entries = Object.entries(variables ?? {});
    if (!entries.length)
        return [`变量: ${cliHelpers_1.DASH}`];
    const rows = [['名称', '值']].concat(entries.map(([name, value]) => [name, (0, cliHelpers_1.dash)(value)]));
    return [`变量 (${entries.length})`, (0, cliHelpers_1.renderTable)(rows, { 1: { truncate: 80 } })];
}
function instanceHeader(v) {
    return [
        `实例 #${(0, cliHelpers_1.dash)(v.id)} [${(0, cliHelpers_1.dash)(v.status)}]  模板 #${(0, cliHelpers_1.dash)(v.templateId)} ${(0, cliHelpers_1.dash)(v.templateName)} (${(0, cliHelpers_1.dash)(v.templateType)} v${(0, cliHelpers_1.dash)(v.version)})`,
        `目标:     ${scope(v.orgId)}  产品 #${(0, cliHelpers_1.dash)(v.productId)}    产出: ${(0, cliHelpers_1.dash)(v.createdObjectType)}${v.createdObjectId ? ` #${v.createdObjectId}` : ''}${v.packageId ? `    模板包 #${v.packageId}` : ''}`,
        `创建:     ${(0, cliHelpers_1.fmtDateTime)(v.createdAt)} by ${(0, cliHelpers_1.dash)(v.createdBy)}`,
    ];
}
/** Result of `template use`. */
function renderInstantiated(v, writtenTo) {
    const head = instanceHeader(v);
    return [
        `✓ 已实例化: ${head[0]}`, ...head.slice(1), '',
        ...renderCreatedObjects(v.createdObjects), ...warningLines(v.warnings),
        ...((0, renderBody_1.documentBody)(v.renderedContent) || writtenTo ? ['', ...(0, renderBody_1.resultLines)(v.renderedContent, writtenTo)] : []),
        '', `后续: good7ob template instance ${(0, cliHelpers_1.dash)(v.id)} 查看；模板有新版本时 good7ob template upgrade ${(0, cliHelpers_1.dash)(v.id)}`,
    ].join('\n');
}
exports.renderInstantiated = renderInstantiated;
/** `template instance <id>`. */
function renderInstance(v, writtenTo) {
    return [
        ...instanceHeader(v), '', ...renderVariableValues(v.variables), '', ...renderCreatedObjects(v.createdObjects),
        '', ...(0, renderBody_1.resultLines)(v.renderedContent, writtenTo),
    ].join('\n').trimEnd();
}
exports.renderInstance = renderInstance;
function renderInstanceList(result, pageNum, pageSize) {
    const records = (0, extractRecords_1.extractRecords)(result);
    if (!records.length)
        return '还没有实例。';
    const rows = [['ID', '状态', '类型', '模板', '版本', '组织', '产品', '产出', '包', '创建时间']].concat(records.map((v) => [
        (0, cliHelpers_1.dash)(v.id), (0, cliHelpers_1.dash)(v.status), (0, cliHelpers_1.dash)(v.templateType), `#${(0, cliHelpers_1.dash)(v.templateId)} ${(0, cliHelpers_1.dash)(v.templateName)}`, (0, cliHelpers_1.dash)(v.version),
        (0, cliHelpers_1.dash)(v.orgId), (0, cliHelpers_1.dash)(v.productId), v.createdObjectType ? `${v.createdObjectType}${v.createdObjectId ? ` #${v.createdObjectId}` : ''}` : cliHelpers_1.DASH,
        (0, cliHelpers_1.dash)(v.packageId), (0, cliHelpers_1.fmtDateTime)(v.createdAt),
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 3: { truncate: 36 } })}\n${(0, render_1.pageFooter)(result, records, pageNum, pageSize)}`;
}
exports.renderInstanceList = renderInstanceList;
/** Result of `template package use`: one line per instance, then the total. */
function renderPackageInstantiation(v) {
    const instances = v.instances ?? [];
    const rows = [['实例', '模板', '类型', '版本', '产出', '对象数']].concat(instances.map((i) => [
        `#${(0, cliHelpers_1.dash)(i.id)}`, `#${(0, cliHelpers_1.dash)(i.templateId)} ${(0, cliHelpers_1.dash)(i.templateName)}`, (0, cliHelpers_1.dash)(i.templateType), (0, cliHelpers_1.dash)(i.version),
        i.createdObjectType ? `${i.createdObjectType}${i.createdObjectId ? ` #${i.createdObjectId}` : ''}` : cliHelpers_1.DASH, String(i.createdObjects?.length ?? 0),
    ]));
    return [
        `✓ 已实例化模板包 #${(0, cliHelpers_1.dash)(v.packageId)} ${(0, cliHelpers_1.dash)(v.packageName)}: ${instances.length} 个实例，共创建 ${(0, cliHelpers_1.dash)(v.createdObjectCount)} 个对象（整包一个事务）`,
        ...(instances.length ? [(0, cliHelpers_1.renderTable)(rows, { 1: { truncate: 36 } })] : []), ...warningLines(v.warnings),
        '', '查看某个实例的对象 / 文档: good7ob template instance <实例 ID>',
    ].join('\n');
}
exports.renderPackageInstantiation = renderPackageInstantiation;
// ── installs ──
function renderInstalled(v) {
    const name = v.templateName ? `${v.templateName} ` : '';
    const state = v.created ? '已安装' : '已是安装状态（未变化）';
    return [
        `✓ ${state}: 模板 #${(0, cliHelpers_1.dash)(v.templateId)} ${name}v${(0, cliHelpers_1.dash)(v.version)}  ${scope(v.orgId)}`,
        ...(v.upgradeAvailable ? [`  有新版本 ${(0, cliHelpers_1.dash)(v.publishedVersion)} 可用（再次 install --version ${(0, cliHelpers_1.dash)(v.publishedVersion)} 切换）`] : []),
        ...(v.dependencies?.items?.length ? ['', ...(0, renderCheck_1.renderDependencyCheck)(v.dependencies)] : []),
    ].join('\n');
}
exports.renderInstalled = renderInstalled;
function renderInstalledList(result, pageNum, pageSize) {
    const records = (0, extractRecords_1.extractRecords)(result);
    if (!records.length)
        return '还没有安装任何模板。';
    const rows = [['ID', '模板', '类型', '范围', '已装版本', '最新版本', '可升级', '安装时间']].concat(records.map((v) => [
        (0, cliHelpers_1.dash)(v.id), `#${(0, cliHelpers_1.dash)(v.templateId)} ${v.templateStatus === 'UNAVAILABLE' ? '（已不可见）' : (0, cliHelpers_1.dash)(v.templateName)}`, (0, cliHelpers_1.dash)(v.templateType),
        v.orgId ? `组织 #${v.orgId}` : '个人', (0, cliHelpers_1.dash)(v.version), (0, cliHelpers_1.dash)(v.publishedVersion), v.upgradeAvailable ? '是' : '否', (0, cliHelpers_1.fmtDateTime)(v.installedAt),
    ]));
    return `${(0, cliHelpers_1.renderTable)(rows, { 1: { truncate: 36 } })}\n${(0, render_1.pageFooter)(result, records, pageNum, pageSize)}`;
}
exports.renderInstalledList = renderInstalledList;
//# sourceMappingURL=renderUse.js.map