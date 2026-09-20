"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDryRun = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const renderCheck_1 = require("./renderCheck");
const renderBody_1 = require("./renderBody");
const TARGET_LABELS = {
    orgId: '组织', productId: '产品', moduleId: '模块', suiteId: '用例目录', plannedStartDate: '计划开始', plannedEndDate: '计划结束',
};
function renderDryRun(r, writtenTo) {
    const vars = Object.entries(r.variables);
    const target = Object.entries(r.target).map(([k, v]) => `${TARGET_LABELS[k] ?? k} ${k.endsWith('Id') ? '#' : ''}${(0, cliHelpers_1.dash)(v)}`).join('  ');
    return [
        'DRY-RUN 预演：没有创建任何对象，没有写入任何数据（服务端只被读取）',
        `模板 #${r.templateId} ${(0, cliHelpers_1.dash)(r.templateName)} (${(0, cliHelpers_1.dash)(r.templateType)})  版本 ${(0, cliHelpers_1.dash)(r.version)}  目标: ${target || cliHelpers_1.DASH}`,
        '', ...(0, renderCheck_1.renderDependencyCheck)(r.dependencies),
        '', ...(vars.length ? [`变量 (${vars.length}，已按版本定义校验并补全默认值)`, (0, cliHelpers_1.renderTable)([['名称', '值']].concat(vars.map(([k, v]) => [k, (0, cliHelpers_1.dash)(v)])), { 1: { truncate: 80 } })] : [`变量: ${cliHelpers_1.DASH}`]),
        '', `将创建: ${r.plan.join('；')}`,
        '', ...(0, renderBody_1.resultLines)(r.renderedContent, writtenTo),
        '', ...r.notes.map((n) => `注: ${n}`),
        r.ready ? '预检: ✓ 本地可确认的部分都通过（去掉 --dry-run 即真正实例化）' : '预检: ✗ 预计会失败：',
        ...r.issues.map((i) => `  - ${i}`),
        '未验证（只有服务端能判断）: 你是否是该组织的活跃成员、产品 / 模块 / 用例目录是否属于该组织、渲染结果的类型结构校验。',
    ].join('\n');
}
exports.renderDryRun = renderDryRun;
//# sourceMappingURL=renderDryRun.js.map