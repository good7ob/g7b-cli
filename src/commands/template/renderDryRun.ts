import { DASH, dash, renderTable } from '../../utils/cliHelpers';
import { DryRunReport } from './dryRun';
import { renderDependencyCheck } from './renderCheck';
import { resultLines } from './renderBody';

const TARGET_LABELS: Record<string, string> = {
  orgId: '组织', productId: '产品', moduleId: '模块', suiteId: '用例目录', plannedStartDate: '计划开始', plannedEndDate: '计划结束',
};

export function renderDryRun(r: DryRunReport, writtenTo?: string): string {
  const vars = Object.entries(r.variables);
  const target = Object.entries(r.target).map(([k, v]) => `${TARGET_LABELS[k] ?? k} ${k.endsWith('Id') ? '#' : ''}${dash(v)}`).join('  ');
  return [
    'DRY-RUN 预演：没有创建任何对象，没有写入任何数据（服务端只被读取）',
    `模板 #${r.templateId} ${dash(r.templateName)} (${dash(r.templateType)})  版本 ${dash(r.version)}  目标: ${target || DASH}`,
    '', ...renderDependencyCheck(r.dependencies),
    '', ...(vars.length ? [`变量 (${vars.length}，已按版本定义校验并补全默认值)`, renderTable([['名称', '值']].concat(vars.map(([k, v]) => [k, dash(v)])), { 1: { truncate: 80 } })] : [`变量: ${DASH}`]),
    '', `将创建: ${r.plan.join('；')}`,
    '', ...resultLines(r.renderedContent, writtenTo),
    '', ...r.notes.map((n) => `注: ${n}`),
    r.ready ? '预检: ✓ 本地可确认的部分都通过（去掉 --dry-run 即真正实例化）' : '预检: ✗ 预计会失败：',
    ...r.issues.map((i) => `  - ${i}`),
    '未验证（只有服务端能判断）: 你是否是该组织的活跃成员、产品 / 模块 / 用例目录是否属于该组织、渲染结果的类型结构校验。',
  ].join('\n');
}
