import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { InputError, collect, emit, guarded, parseId } from '../../utils/cliHelpers';
import {
  HABIT_ERROR_CODES, buildWorkflowBody, confirmOrThrow, hasWorkflowEdits, oneOf, parseScene, parseVersion, workflowOverrides,
} from './input';
import { Workflow, statusLabel, renderWorkflow, renderWorkflows } from './render';

/** good7ob habit workflow：个人工作流（FP-9 / FP-11 / FP-17）。不提供运行（启动）命令。 */

const WF = '/api/v1/me/work-workflows';
const run = (prefix: string, fn: () => Promise<void>) => guarded(prefix, HABIT_ERROR_CODES, fn);
const get = (id: number): Promise<Workflow> => apiClient.get(`${WF}/${id}`);

const contentFlags = (c: Command) =>
  c.option('--name <text>', '名称（≤50 字）')
    .option('--description <text>', '说明（≤200 字）')
    .option('--scene <scene>', 'daily（每天）| task（单任务）')
    .option('--step <title>', '步骤标题，可重复，按出现顺序（整体替换所有步骤；要保留步骤 ID 与关联习惯请用 --from-file）', collect, [])
    .option('--from-file <path>', 'JSON / YAML 文件：步骤数组，或 { name, description, scene, steps:[{id?,title,description,habitIds}] }');

/** 当前内容转成整体保存用的结构（保留步骤 ID 与关联的启用习惯）。 */
const asBase = (w: Workflow) => ({
  name: w.name, description: w.description ?? '', scene: w.scene,
  steps: (w.steps ?? []).map((s) => ({ id: s.id, title: s.title, description: s.description ?? '', habitIds: (s.habits ?? []).map((h) => h.id) })),
});

const saved = (verb: string) => (w: Workflow) => `✓ 已${verb}工作流 #${w.id}「${w.name}」，${statusLabel(w.status)}，版本 ${w.version}`;

export function registerWorkflowCommands(habit: Command) {
  const wf = habit.command('workflow').description('个人工作流（子命令: list show add edit enable disable default remove）');

  wf.command('list')
    .description('列出工作流（默认不含草稿，草稿用 draft list）')
    .option('--scene <scene>', 'daily | task')
    .option('--status <s>', 'ENABLED | DISABLED')
    .option('--json', '输出 JSON')
    .action((o) => run('读取工作流列表失败', async () => {
      const params = { scene: o.scene ? parseScene(o.scene) : undefined, status: o.status ? oneOf(o.status, ['ENABLED', 'DISABLED'], '--status') : undefined };
      const data = await apiClient.get(WF, Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)));
      emit(o.json, data, () => renderWorkflows(data));
    }));

  wf.command('show <id>')
    .description('工作流详情（含步骤与关联习惯）')
    .option('--json', '输出 JSON')
    .action((idRaw, o) => run('读取工作流失败', async () => {
      const w = await get(parseId(idRaw, 'id'));
      emit(o.json, w, () => renderWorkflow(w));
    }));

  contentFlags(wf.command('add'))
    .description('新增工作流（需 --name、--scene 与 --step 或 --from-file；新建后为启用、非默认）')
    .option('--json', '输出 JSON')
    .action((o) => run('新增工作流失败', async () => {
      const w: Workflow = await apiClient.post(WF, buildWorkflowBody(workflowOverrides(o)));
      emit(o.json, w, () => saved('新增')(w));
    }));

  contentFlags(wf.command('edit <id>'))
    .description('整体保存工作流：给出的字段覆盖当前值，未给出的保持；version 自动取当前值')
    .option('--version <n>', '期望的版本号（与服务端不一致返回 1009）')
    .option('--json', '输出 JSON')
    .action((idRaw, o) => run('修改工作流失败', async () => {
      const id = parseId(idRaw, 'id');
      const over = workflowOverrides(o);
      if (!hasWorkflowEdits(over)) throw new InputError('至少给出 --name / --description / --scene / --step / --from-file 之一');
      const expected = parseVersion(o.version);
      buildWorkflowBody(over, { name: 'x', scene: 'EVERY_DAY', steps: [{ title: 'x', description: '', habitIds: [] }] }); // 先校验给出的字段，再取当前值合并
      const current = await get(id);
      const body = { ...buildWorkflowBody(over, asBase(current)), version: expected ?? current.version };
      const w: Workflow = await apiClient.put(`${WF}/${id}`, body);
      emit(o.json, w, () => saved('修改')(w));
    }));

  for (const [name, status, verb] of [['enable', 'ENABLED', '启用'], ['disable', 'DISABLED', '停用']] as const) {
    wf.command(`${name} <id>`)
      .description(`${verb}工作流${name === 'disable' ? '（默认工作流停用后该场景无默认）' : ''}`)
      .option('--json', '输出 JSON')
      .action((idRaw, o) => run(`${verb}工作流失败`, async () => {
        const id = parseId(idRaw, 'id');
        const w: Workflow = await apiClient.post(`${WF}/${id}/status`, { status, version: (await get(id)).version });
        emit(o.json, w, () => saved(verb)(w));
      }));
  }

  wf.command('default <id>')
    .description('设为该场景的默认工作流（须已启用；原默认自动取消）')
    .option('--json', '输出 JSON')
    .action((idRaw, o) => run('设置默认工作流失败', async () => {
      const id = parseId(idRaw, 'id');
      const w: Workflow = await apiClient.post(`${WF}/${id}/default`, { version: (await get(id)).version });
      emit(o.json, w, () => saved('设为默认')(w));
    }));

  wf.command('remove <id>')
    .description('删除工作流（软删除；不影响已启动的运行）')
    .option('--yes', '跳过二次确认')
    .option('--json', '输出 JSON')
    .action((idRaw, o) => run('删除工作流失败', async () => {
      const id = parseId(idRaw, 'id');
      if (!(await confirmOrThrow(o.yes, `将删除工作流 #${id}`))) return void console.log('已取消');
      await apiClient.delete(`${WF}/${id}`);
      emit(o.json, { id, removed: true }, () => `✓ 已删除工作流 #${id}`);
    }));
}
