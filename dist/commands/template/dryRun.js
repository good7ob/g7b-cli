"use strict";
/**
 * `template use --dry-run`: everything a real instantiation would check that the CLI can know, and nothing written.
 * Reads the template + version (GET), the dependency check (GET) and renders the content locally; never POSTs.
 * Membership of the org, ownership of the product / module / suite and the per-type structural validation of the
 * rendered result can only be judged by the server, so they are listed as not verified.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dryRunInstantiate = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const localRender_1 = require("./localRender");
const useInput_1 = require("./useInput");
const BASE = '/templates';
const LIMITS = { TASK: ['tasks', 200], PROJECT: ['tasks', 200], TEST: ['cases', 500], WORKFLOW: ['stages', 50] };
const PUBLISHED_EVER = ['PUBLISHED', 'ARCHIVED'];
const list = (content, key) => {
    const value = content?.[key];
    return Array.isArray(value) ? value : [];
};
/** What the server would create, read off the locally rendered content. */
function describePlan(type, content, moduleId) {
    const rendered = content;
    switch (type) {
        case 'TASK': return [`${list(content, 'tasks').length} 个任务，建入模块 #${moduleId ?? '—'}`];
        case 'PROJECT': return [`1 个模块「${String(rendered?.module?.name ?? '—')}」+ ${list(content, 'tasks').length} 个任务`];
        case 'TEST': return [`${list(content, 'cases').length} 个测试用例`];
        case 'WORKFLOW': return [`1 个工作流模板，${list(content, 'stages').length} 个阶段`];
        case 'RELEASE': return [`1 个发布「${String(rendered?.name ?? '—')}」版本号 ${String(rendered?.version ?? '—')}`];
        case 'PRD': return ['1 个 PRD 会话 + 1 份初稿文档'];
        default: return ['文档型实例：只保存渲染结果，不创建业务对象'];
    }
}
function targetIssues(type, o, content) {
    const use = useInput_1.TARGET_USE[type] ?? {};
    const issues = [];
    const notes = [];
    if (use.module === 'required' && o.module === undefined)
        issues.push('TASK 模板必须指定 --module <moduleId>（服务端 1000）');
    if (o.module !== undefined && !use.module)
        notes.push(`--module 对 ${type} 类型无效，服务端会忽略`);
    if (o.suite !== undefined && !use.suite)
        notes.push(`--suite 对 ${type} 类型无效，服务端会忽略`);
    if ((o.start !== undefined || o.end !== undefined) && !use.dates)
        notes.push(`--start / --end 对 ${type} 类型无效，服务端会忽略`);
    if (type === 'RELEASE' && !String(content?.version ?? '').trim()) {
        issues.push('RELEASE 渲染出的 version 为空（服务端 1001）：请补全对应变量');
    }
    const [key, max] = LIMITS[type] ?? [];
    if (key && list(content, key).length > max)
        issues.push(`渲染结果的 ${key} 超过 ${max} 个（服务端 1001）`);
    return { issues, notes };
}
function dependencyIssues(deps, withDeps) {
    if (!withDeps)
        return deps.satisfied === false ? [`缺少 ${deps.missingRequired ?? '若干'} 个必需依赖（服务端 1007）：先安装，或加 --with-deps`] : [];
    return (deps.items ?? [])
        .filter((i) => i.kind === 'requires' && i.status !== 'OK' && !i.installable)
        .map((i) => `必需依赖 #${i.templateId} ${i.templateName ?? ''} 状态 ${i.status}，装不上，即使 --with-deps 也会失败（服务端 1007）`);
}
async function loadVersion(id, detail, version) {
    const loaded = version === undefined
        ? detail.version
        : await ApiClient_1.default.get(`${BASE}/${id}/versions/${version}`);
    if (!loaded)
        throw new cliHelpers_1.InputError(`模板 #${id} 没有已发布版本，无法实例化`);
    return loaded;
}
async function dryRunInstantiate(id, o, body, variables) {
    const detail = await ApiClient_1.default.get(`${BASE}/${id}`);
    const version = await loadVersion(id, detail, o.version);
    const dependencies = await ApiClient_1.default.get(`${BASE}/${id}/dependencies/check`, (0, useInput_1.buildDepsParams)(o));
    const resolved = (0, localRender_1.resolveAgainstDefs)(version.variables ?? [], variables);
    const renderedContent = (0, localRender_1.renderLocally)(version.content, resolved.text);
    const type = String(detail.templateType ?? '');
    const target = targetIssues(type, o, renderedContent);
    const issues = [
        ...(detail.status && detail.status !== 'PUBLISHED' ? [`模板状态为 ${detail.status}，只能实例化已发布的模板（服务端 1007）`] : []),
        ...(o.version !== undefined && version.status && !PUBLISHED_EVER.includes(version.status) ? [`版本 ${o.version} 没有发布过（服务端 1002）`] : []),
        ...target.issues,
        ...dependencyIssues(dependencies, o.withDeps),
    ];
    return {
        dryRun: true, ready: issues.length === 0, templateId: id, templateName: detail.name, templateType: detail.templateType,
        templateStatus: detail.status, version: version.version, dependencies, variables: resolved.typed, renderedContent,
        target: Object.fromEntries(Object.entries(body).filter(([k]) => !['variables', 'version', 'installDependencies'].includes(k))),
        plan: describePlan(type, renderedContent, body.moduleId), issues, notes: target.notes,
    };
}
exports.dryRunInstantiate = dryRunInstantiate;
//# sourceMappingURL=dryRun.js.map