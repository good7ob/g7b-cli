import { writeFileSync } from 'fs';
import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { AI_REQUEST_CONFIG, InputError, emit, guarded, parseId, withTimeoutHint } from '../../utils/cliHelpers';
import {
  AI_TIMEOUT_HINT, HABIT_ERROR_CODES, SCOPES, buildFilters, buildHabitBody, confirmOrThrow, hasHabitEdits, oneOf,
  parseDays, parseSources, parseVersion, precheckHabitEdits,
} from './input';
import { Habit, flatten, renderHabit, renderHabits, renderUsage } from './render';
import { registerWorkflowCommands } from './workflow';

/**
 * good7ob habit：我的工作习惯（prd-0127 FP-7）。只操作本人数据（身份取自登录态 / API Key，接口不接收用户 ID）。
 * 运行（启动）工作流只由 Agent / AI 员工经 MCP 触发，CLI 不提供。内容不写日志文件，只打印到终端 / 指定的 --out。
 */

const BASE = '/api/v1/me/work-habits';
const run = (prefix: string, fn: () => Promise<void>) => guarded(prefix, HABIT_ERROR_CODES, fn);

const withFilters = (c: Command) =>
  c.option('--keyword <text>', '标题或内容包含')
    .option('--category <c>', 'PROCESS | CODE | COMMUNICATION | TOOL | OTHER')
    .option('--level <l>', 'STABLE | LOCAL')
    .option('--source <s>', 'MANUAL | AI_EXTRACTED');

const editFlags = (c: Command) =>
  c.option('--title <text>', '标题（≤50 字）')
    .option('--content <text>', '内容（≤500 字）')
    .option('--category <c>', 'PROCESS | CODE | COMMUNICATION | TOOL | OTHER')
    .option('--level <l>', 'STABLE（稳定偏好）| LOCAL（局部习惯，默认）');

/** 读出习惯的当前 version（接口无单条 GET，从列表里找；候选用 status=PENDING）。 */
async function findHabit(id: number, status?: string): Promise<Habit> {
  const data = await apiClient.get(BASE, status ? { status } : undefined);
  const found = flatten<Habit>(data).find((h) => h.id === id);
  if (!found) {
    const hint = status === 'PENDING' ? '（不是待确认候选；已确认的习惯请用 habit list）' : '（待确认候选请用 habit confirm / reject）';
    throw Object.assign(new Error(`未找到习惯 #${id}${hint}`), { code: 1002 });
  }
  return found;
}

export function registerHabitCommands(program: Command) {
  const habit = program.command('habit').description('我的工作习惯与个人工作流（子命令: list add edit enable disable remove export candidates confirm reject extract workflow）');

  withFilters(habit.command('list'))
    .description('列出习惯（默认含启用与停用，不含待确认候选）')
    .option('--status <s>', 'ENABLED | DISABLED')
    .option('--json', '输出 JSON')
    .action((o) => run('读取习惯列表失败', async () => {
      const data = await apiClient.get(BASE, buildFilters(o));
      emit(o.json, data, () => renderHabits(data));
    }));

  editFlags(habit.command('add'))
    .description('新增习惯（必填 --title --content --category）')
    .option('--json', '输出 JSON')
    .action((o) => run('新增习惯失败', async () => {
      const created: Habit = await apiClient.post(BASE, buildHabitBody(o));
      emit(o.json, created, () => renderHabit(created, '新增'));
    }));

  editFlags(habit.command('edit <id>'))
    .description('修改习惯（只改给出的字段；version 自动取当前值，可用 --version 指定你看到的版本以防覆盖他人改动）')
    .option('--version <n>', '期望的版本号（与服务端不一致返回 1009）')
    .option('--json', '输出 JSON')
    .action((idRaw, o) => run('修改习惯失败', async () => {
      const id = parseId(idRaw, 'id');
      if (!hasHabitEdits(o)) throw new InputError('至少给出 --title / --content / --category / --level 之一');
      precheckHabitEdits(o);
      const expected = parseVersion(o.version);
      const current = await findHabit(id);
      const body = { ...buildHabitBody(o, current), version: expected ?? current.version };
      const updated: Habit = await apiClient.put(`${BASE}/${id}`, body);
      emit(o.json, updated, () => renderHabit(updated, '修改'));
    }));

  for (const [name, status, verb] of [['enable', 'ENABLED', '启用'], ['disable', 'DISABLED', '停用']] as const) {
    habit.command(`${name} <id>`)
      .description(`${verb}习惯`)
      .option('--json', '输出 JSON')
      .action((idRaw, o) => run(`${verb}习惯失败`, async () => {
        const id = parseId(idRaw, 'id');
        const current = await findHabit(id);
        const updated: Habit = await apiClient.post(`${BASE}/${id}/status`, { status, version: current.version });
        emit(o.json, updated, () => renderHabit(updated, verb));
      }));
  }

  habit.command('remove <id>')
    .description('删除习惯（软删除，不可在 CLI 恢复）')
    .option('--yes', '跳过二次确认')
    .option('--json', '输出 JSON')
    .action((idRaw, o) => run('删除习惯失败', async () => {
      const id = parseId(idRaw, 'id');
      if (!(await confirmOrThrow(o.yes, `将删除习惯 #${id}`))) return void console.log('已取消');
      await apiClient.delete(`${BASE}/${id}`);
      emit(o.json, { id, removed: true }, () => `✓ 已删除习惯 #${id}`);
    }));

  withFilters(habit.command('export'))
    .description('导出启用的习惯为 Markdown（默认打印到标准输出）')
    .option('--status <s>', '仅 --scope filtered 生效')
    .option('--scope <scope>', 'enabled（全部启用条目，默认）| filtered（按筛选条件）', 'enabled')
    .option('--include-workflows', '追加「工作流」章节（本人全部启用的工作流）')
    .option('--out <file>', '写入文件')
    .option('--json', '输出接口返回的 JSON（含 markdown / habitCount / workflowCount / filename）')
    .action((o) => run('导出习惯失败', async () => {
      const scope = oneOf(o.scope, SCOPES.map((s) => s.toUpperCase()), '--scope').toLowerCase();
      const params = { scope, includeWorkflows: o.includeWorkflows ? 'true' : undefined, ...(scope === 'filtered' ? buildFilters(o) : {}) };
      const data = await apiClient.get(`${BASE}/export`, Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)));
      const md: string = data?.markdown ?? '';
      if (o.out) {
        writeFileSync(o.out, md.endsWith('\n') ? md : `${md}\n`);
        return emit(o.json, data, () => `✓ 已写入 ${o.out}（习惯 ${data.habitCount} 条，工作流 ${data.workflowCount ?? 0} 个）`);
      }
      // 标准输出保持原样（不过滤控制字符），便于 > file 重定向
      console.log(o.json ? JSON.stringify(data, null, 2) : md.replace(/\n$/, ''));
    }));

  withFilters(habit.command('candidates'))
    .description('列出待确认的 AI 提取候选（需后端 P2 已部署）')
    .option('--json', '输出 JSON')
    .action((o) => run('读取候选失败', async () => {
      const data = await apiClient.get(BASE, buildFilters({ ...o, status: 'PENDING' }));
      emit(o.json, data, () => renderHabits(data, true));
    }));

  editFlags(habit.command('confirm <id>'))
    .description('确认候选（可带 --title/--content/--category/--level 编辑后确认；不带则原样确认）')
    .option('--json', '输出 JSON')
    .action((idRaw, o) => run('确认候选失败', async () => {
      const id = parseId(idRaw, 'id');
      precheckHabitEdits(o);
      const current = await findHabit(id, 'PENDING');
      const edits = hasHabitEdits(o) ? buildHabitBody(o, current) : {};
      const confirmed: Habit = await apiClient.post(`${BASE}/${id}/confirm`, { version: current.version, ...edits });
      emit(o.json, confirmed, () => renderHabit(confirmed, '确认'));
    }));

  habit.command('reject <id>')
    .description('拒绝候选（之后不会再从同一批证据提取出它）')
    .option('--json', '输出 JSON')
    .action((idRaw, o) => run('拒绝候选失败', async () => {
      const id = parseId(idRaw, 'id');
      const current = await findHabit(id, 'PENDING');
      await apiClient.post(`${BASE}/${id}/reject`, { version: current.version });
      emit(o.json, { id, rejected: true }, () => `✓ 已拒绝候选 #${id}`);
    }));

  habit.command('extract')
    .description('触发 AI 从你的工作日志 / 提交 / 任务记录提取习惯候选（同步等待；消耗 AI 额度，自带 Key 时不扣费）')
    .option('--days <n>', '回看天数 1～90', '30')
    .option('--sources <list>', '逗号分隔：WORK_LOG,COMMIT,TASK（默认全选）')
    .option('--json', '输出 JSON')
    .action((o) => run('提取习惯候选失败', async () => {
      const body = { days: parseDays(o.days), sources: parseSources(o.sources, 'extract') };
      console.error('正在调用 AI 提取习惯候选，会消耗 AI 额度（自带 API Key 时不扣费），请稍候…');
      const res = await apiClient.post(`${BASE}/extract`, body, AI_REQUEST_CONFIG).catch((e: unknown) => {
        throw withTimeoutHint(e, AI_TIMEOUT_HINT);
      });
      emit(o.json, res, () => {
        const text = renderHabits({ groups: [{ items: res?.candidates ?? [] }] }, true);
        return `✓ 新增候选 ${res?.createdCount ?? 0} 条，过滤重复 ${res?.filteredCount ?? 0} 条，待确认共 ${res?.pendingTotal ?? 0} 条。${renderUsage(res?.usage)}\n${
          res?.createdCount ? text : '没有发现新的习惯'}\n下一步：good7ob habit confirm <id> | reject <id>`;
      });
    }));

  registerWorkflowCommands(habit);
}
