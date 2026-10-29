/**
 * `good7ob automation` (prd-0135 FP-7 `fun-auto-def-0007`, design n1 §6, backend #989): organisation automations —
 * definitions with a trigger (CRON / PERIODIC / TASK_POOL / MANUAL; EVENT is phase 2), their lifecycle
 * (enable = authorise, pause / resume / disable, manual run), runs, events, the 「计划」 tab and org settings.
 *
 * Every endpoint lives under /api/v1/orgs/{orgId}. The org comes from --org-id / --org, GOOD7OB_ORG_ID,
 * `config set org-id`, or — when the key belongs to exactly one organisation — that organisation.
 * Exit codes (design n1 §6): 0 ok; 3 skipped / conflict (2702 / 2708 / 2709 / 2710 / 2711, a --wait that did not
 * start); 1 anything else.
 */
import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import configService from '../../services/ConfigService';
import { InputError, emit, parseId, parseIntInRange } from '../../utils/cliHelpers';
import { extractRecords } from '../../utils/extractRecords';
import { resolveOrgId } from '../../utils/resolveOrgId';
import { confirmOrThrow } from '../habit/input';
import {
  BILLING, DefinitionFlags, EVERY, EXIT_SKIPPED, SKIP_CODES, SOURCES, STATUSES, SettingsFlags, TRIGGERS,
  actionBody, buildCreateBody, buildListParams, buildPlansParams, buildPreviewBody, buildRunsParams,
  buildSettingsBody, buildUpdateBody, pageParams, parseTriggerType, touchesTrigger,
} from './input';
import {
  Automation, RunResult, RunRow, describeAutomationError, renderActionResult, renderAutomationDetail,
  renderAutomationList, renderEvents, renderPlans, renderPreview, renderRunResult, renderRuns, renderSettings,
} from './render';

type OrgOpts = { orgId?: string; org?: string; json?: boolean };

const ORG_DESC = '组织 ID（默认 GOOD7OB_ORG_ID / config set org-id；只属一个组织时自动取）';

/** --org-id / --org, then env / config, then the only organisation of the key. */
export async function orgOf(o: OrgOpts): Promise<number> {
  const raw = o.orgId ?? o.org;
  if (raw !== undefined) return parseId(raw, '--org-id');
  const configured = configService.get('orgId');
  if (process.env.GOOD7OB_ORG_ID !== undefined || configured !== undefined) return resolveOrgId(undefined, configured);
  const orgs = extractRecords<{ id: number; name?: string }>(await apiClient.get('/api/v1/orgs', { page: 1, pageSize: 20 }));
  if (orgs.length === 1) return orgs[0].id;
  throw new InputError(orgs.length
    ? `你属于 ${orgs.length} 个组织，请用 --org-id 指定：${orgs.map((g) => `#${g.id} ${g.name ?? ''}`.trim()).join('、')}`
    : '缺少组织：请使用 --org-id <id>、环境变量 GOOD7OB_ORG_ID，或 `good7ob config set org-id <id>`');
}

const base = (orgId: number) => `/api/v1/orgs/${orgId}/automations`;

/** A manual run that did not start (--wait): its own message, exit code 3. */
class NotStarted extends Error {}

/** One-line error; 3 for the skipped / conflict codes, 1 otherwise. */
function failAutomation(prefix: string, error: unknown): never {
  if (error instanceof NotStarted) {
    console.error(`✗ ${error.message}`);
    process.exit(EXIT_SKIPPED);
  }
  if (error instanceof InputError) {
    console.error(`✗ 参数错误: ${error.message}`);
    process.exit(1);
  }
  const code = (error as { code?: unknown } | null)?.code;
  console.error(`✗ ${prefix}: ${describeAutomationError(error)}`);
  process.exit(typeof code === 'number' && SKIP_CODES.has(code) ? EXIT_SKIPPED : 1);
}

async function guard(prefix: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    failAutomation(prefix, error);
  }
}

const withOrg = (cmd: Command) => cmd.option('--org-id <id>', ORG_DESC).option('--org <id>', '同 --org-id');

function definitionOptions(cmd: Command, creating: boolean): Command {
  const req = (flags: string, desc: string) => (creating ? cmd.requiredOption(flags, desc) : cmd.option(flags, desc));
  req('--name <name>', '名称（组织内唯一，1-100 字）');
  cmd.option('--description <text>', '说明（≤2000 字）');
  req('--project <id>', '目标项目：从该项目领取待 AI 执行（pending_agent）的任务');
  req('--trigger <type>', `触发方式 ${TRIGGERS.join('|')}（event 属第二期，不支持）`);
  return withOrg(cmd
    .option('--cron <expr>', 'cron 触发：五段表达式（分 时 日 月 周），两次触发间隔 ≥ 5 分钟，如 "0 22 * * 1-5"')
    .option('--every <period>', `周期触发：${EVERY.join('|')}`)
    .option('--at <HH:mm>', '周期触发的时刻')
    .option('--weekday <days>', '每周触发的星期：1-7 或 mon…sun，逗号分隔（--every weekly）')
    .option('--day <day>', '每月触发的日期：1-28 或 last（--every monthly）')
    .option('--timezone <tz>', 'cron / 周期的时区（IANA，如 Asia/Shanghai；默认跟随组织设置）')
    .option('--pool-interval <minutes>', '任务池触发：两次运行的最小间隔 5-1440 分钟（默认 10）')
    .option('--window <HH:mm-HH:mm>', '运行窗口（结束早于开始 = 跨午夜，如 22:00-06:00；none 取消）')
    .option('--window-weekday <days>', '运行窗口生效的星期（1-7 或 mon…sun；默认每天）')
    .option('--grace <minutes>', '没有可用 Runner 时的宽限 1-60 分钟（默认 10）')
    .option('--task-filter <json>', '任务筛选 JSON：{"labels":[…],"priorities":[…],"executorEmployeeId":N}；none 清空')
    .option('--tags <tags>', '任务筛选：带任一标签（逗号分隔）')
    .option('--priority <list>', '任务筛选：优先级（逗号分隔，如 high,urgent）')
    .option('--executor <employeeId>', '任务筛选：只取预分配给该 AI 员工的任务')
    .option('--max-tasks <n>', '每次运行最多领取的任务数 1-20（默认 1）')
    .option('--budget-tokens <n>', '单次运行 Token 上限（unlimited = 不限）')
    .option('--daily-budget-tokens <n>', '当日 Token 上限（unlimited = 不限）。注意：只给 --budget-tokens 时当日上限按"不限"保存')
    .option('--billing <subject>', `计费主体 ${BILLING.join('|')}（默认跟随组织计费模式）`)
    .option('--json', '输出 JSON'));
}

// ── manual run --wait ──

/** Indirection so tests can run the poll loop without real time passing. */
export const clock = {
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};
const POLL_MS = 5_000;
const NOT_STARTED = ['draft', 'scheduled'];
const STARTED = ['running', 'pausing', 'paused', 'completed'];

/** Polls the runs list until the run leaves `scheduled` or the timeout passes; returns its status or 'timeout'. */
async function waitForRun(url: string, runId: number, timeoutMinutes: number): Promise<string> {
  const deadline = clock.now() + timeoutMinutes * 60_000;
  for (;;) {
    const rows = extractRecords<RunRow>(await apiClient.get(`${url}/runs`, { page: 1, pageSize: 20 }));
    const status = rows.find((r) => r.kind !== 'SKIPPED' && r.runId === runId)?.status;
    if (status && !NOT_STARTED.includes(status)) return status;
    if (clock.now() >= deadline) return 'timeout';
    await clock.sleep(POLL_MS);
  }
}

export function registerAutomationCommands(program: Command) {
  const automation = program
    .command('automation')
    .description('自动化 — 定义（定时 / 周期 / 任务池 / 手动触发）、启用即授权、暂停 / 恢复 / 停用、手动运行、运行与事件、计划、组织设置（prd-0135）');

  withOrg(automation.command('list')
    .description('列出组织的自动化（下次运行升序，无下次运行的在后）')
    .option('--status <status>', `按状态过滤（${STATUSES.join('|')}）`)
    .option('--project <id>', '按目标项目过滤')
    .option('--trigger <type>', `按触发方式过滤（${TRIGGERS.join('|')}|event）`)
    .option('--keyword <text>', '名称关键字')
    .option('-p, --page <num>', '页码', '1')
    .option('--page-size <num>', '每页条数（1-100）', '20')
    .option('--json', '输出 JSON'))
    .action((o) => guard('获取自动化列表失败', async () => {
      const params = buildListParams(o);
      const result = await apiClient.get(base(await orgOf(o)), params);
      emit(o.json, result, () => renderAutomationList(result, Number(params.page), Number(params.pageSize)));
    }));

  withOrg(automation.command('show <id>')
    .description('自动化详情：触发、下次运行、目标与当前匹配任务数、预算、计费与启用人、最近 10 次运行（含跳过）')
    .option('--json', '输出 JSON'))
    .action((id, o) => guard('获取自动化详情失败', async () => {
      const aid = parseId(id, 'id');
      const detail: Automation = await apiClient.get(`${base(await orgOf(o))}/${aid}`);
      emit(o.json, detail, () => renderAutomationDetail(detail ?? { id: aid }));
    }));

  definitionOptions(automation.command('create')
    .description('新建自动化（保存为草稿，用 automation enable 启用）'), true)
    .action((o: DefinitionFlags & OrgOpts) => guard('新建自动化失败', async () => {
      const body = buildCreateBody(o);
      const created: Automation = await apiClient.post(base(await orgOf(o)), body);
      emit(o.json, created, () => `✓ 已新建自动化 #${created?.id}「${created?.name ?? body.name}」（${created?.status ?? 'draft'}）` +
        `\n  启用：good7ob automation enable ${created?.id}    预览触发时刻：good7ob automation preview …`);
    }));

  definitionOptions(automation.command('update <id>')
    .description('修改自动化（只改给出的字段；已启用且组织要求启用审批时进入审批，批准后生效）'), false)
    .action((id, o: DefinitionFlags & OrgOpts) => guard('修改自动化失败', async () => {
      const aid = parseId(id, 'id');
      if (o.trigger !== undefined) parseTriggerType(o.trigger); // EVENT / typo rejected before any call
      const orgId = await orgOf(o);
      const current: Automation = await apiClient.get(`${base(orgId)}/${aid}`);
      let orgTimeZone: string | undefined;
      if (touchesTrigger(o) && o.timezone === undefined && current?.trigger?.timeZone) {
        orgTimeZone = (await apiClient.get(`/api/v1/orgs/${orgId}/automation-settings`))?.timeZone;
      }
      const body = buildUpdateBody(o, current ?? {}, orgTimeZone);
      const updated: Automation = await apiClient.put(`${base(orgId)}/${aid}`, body);
      emit(o.json, updated, () => renderActionResult(updated ?? { id: aid }, '已更新'));
    }));

  withOrg(automation.command('delete <id>')
    .description('删除自动化（仅草稿或已停用，且没有未结束的运行）')
    .option('-y, --yes', '跳过确认'))
    .action((id, o: OrgOpts & { yes?: boolean }) => guard('删除自动化失败', async () => {
      const aid = parseId(id, 'id');
      const orgId = await orgOf(o);
      if (!(await confirmOrThrow(o.yes, `确认删除自动化 #${aid}？`))) {
        console.log('已取消');
        return;
      }
      await apiClient.delete(`${base(orgId)}/${aid}`);
      console.log(`✓ 已删除自动化 #${aid}`);
    }));

  withOrg(automation.command('run <id>')
    .description('手动运行一次（已启用或已暂停；仅 owner/admin）：返回运行 ID（= 执行计划 ID）与状态')
    .option('--wait', '等待运行开始（running）或被跳过，最长一个宽限期')
    .option('--wait-timeout <minutes>', '--wait 的最长等待分钟数（默认取该自动化的宽限期）')
    .option('--json', '输出 JSON'))
    .action((id, o: OrgOpts & { wait?: boolean; waitTimeout?: string }) => guard('手动运行失败', async () => {
      const aid = parseId(id, 'id');
      const timeout = o.waitTimeout !== undefined ? parseIntInRange(o.waitTimeout, '--wait-timeout', 1, 60) : undefined;
      const url = `${base(await orgOf(o))}/${aid}`;
      const result: RunResult = await apiClient.post(`${url}/run`);
      if (!o.wait || !result?.runId || result.status === 'awaiting_approval') {
        emit(o.json, result, () => renderRunResult(aid, result ?? {}) +
          (o.wait && result?.status === 'awaiting_approval' ? '\n  （--wait 不等待审批）' : ''));
        return;
      }
      const minutes = timeout ?? ((await apiClient.get(url) as Automation)?.trigger?.graceMinutes ?? 10);
      if (!o.json) console.log(renderRunResult(aid, result) + `\n  等待开始（最长 ${minutes} 分钟）…`);
      const status = await waitForRun(url, result.runId, minutes);
      const started = STARTED.includes(status);
      if (o.json) console.log(JSON.stringify({ ...result, waitedStatus: status, started }, null, 2));
      else if (started) console.log(`✓ 运行 #${result.runId} 已开始（${status}）`);
      if (!started) {
        throw new NotStarted(status === 'timeout'
          ? `运行 #${result.runId} 在 ${minutes} 分钟内没有开始（仍在排队，可能没有可用 Runner）`
          : `运行 #${result.runId} 未执行（${status}）— good7ob automation runs ${aid}`);
      }
    }));

  const lifecycle = (name: string, desc: string, done: string, failPrefix: string) =>
    withOrg(automation.command(`${name} <id>`)
      .description(desc)
      .option('--reason <text>', '原因（记入事件）')
      .option('--json', '输出 JSON'))
      .action((id, o: OrgOpts & { reason?: string }) => guard(failPrefix, async () => {
        const aid = parseId(id, 'id');
        const body = actionBody(o.reason);
        const res: Automation = await apiClient.post(`${base(await orgOf(o))}/${aid}/${name}`, body);
        emit(o.json, res, () => renderActionResult(res ?? { id: aid }, done));
      }));

  lifecycle('enable', '启用 = 授权（草稿 → 已启用；仅 owner/admin）：记录启用人与计费快照；组织要求启用审批时进入审批', '已启用', '启用自动化失败');
  lifecycle('pause', '暂停（已启用 → 已暂停）；进行中的运行继续', '已暂停', '暂停自动化失败');
  lifecycle('resume', '恢复（已暂停 → 已启用；操作人成为新的启用人）', '已恢复', '恢复自动化失败');
  lifecycle('disable', '停用（已启用 / 已暂停 → 已停用）；进行中的运行继续', '已停用', '停用自动化失败');

  withOrg(automation.command('withdraw-approval <id>')
    .description('撤回审批中的启用 / 修改申请（申请人或 owner/admin），回到原状态')
    .option('--json', '输出 JSON'))
    .action((id, o: OrgOpts) => guard('撤回审批失败', async () => {
      const aid = parseId(id, 'id');
      const res: Automation = await apiClient.post(`${base(await orgOf(o))}/${aid}/withdraw-approval`);
      emit(o.json, res, () => renderActionResult(res ?? { id: aid }, '已撤回审批'));
    }));

  withOrg(automation.command('preview')
    .description('预览 cron / 周期触发接下来的触发时刻（不保存）')
    .option('--cron <expr>', '五段 cron，如 "0 22 * * 1-5"')
    .option('--every <period>', `周期：${EVERY.join('|')}`)
    .option('--at <HH:mm>', '周期触发的时刻')
    .option('--weekday <days>', '每周的星期（1-7 或 mon…sun）')
    .option('--day <day>', '每月的日期（1-28 或 last）')
    .option('--timezone <tz>', 'IANA 时区（默认组织时区）')
    .option('--window <HH:mm-HH:mm>', '运行窗口：标出每个时刻是否在窗口内')
    .option('--window-weekday <days>', '运行窗口生效的星期')
    .option('--count <n>', '预览次数 1-20', '5')
    .option('--json', '输出 JSON'))
    .action((o) => guard('预览触发时刻失败', async () => {
      const body = buildPreviewBody(o);
      const res = await apiClient.post(`${base(await orgOf(o))}/trigger-preview`, body);
      emit(o.json, res, () => renderPreview(res ?? {}));
    }));

  withOrg(automation.command('runs <id>')
    .description('自动化的运行（= 执行计划）与被跳过的触发，新的在前')
    .option('--status <status>', '按运行状态过滤（如 running、completed、failed）')
    .option('-p, --page <num>', '页码', '1')
    .option('--page-size <num>', '每页条数（1-100）', '20')
    .option('--json', '输出 JSON'))
    .action((id, o) => guard('获取运行记录失败', async () => {
      const aid = parseId(id, 'id');
      const params = buildRunsParams(o);
      const res = await apiClient.get(`${base(await orgOf(o))}/${aid}/runs`, params);
      emit(o.json, res, () => renderRuns(res, Number(params.page)));
    }));

  withOrg(automation.command('events <id>')
    .description('自动化的事件（新建、修改、启用、暂停、审批、运行创建、跳过…），新的在前')
    .option('-p, --page <num>', '页码', '1')
    .option('--page-size <num>', '每页条数（1-100）', '20')
    .option('--json', '输出 JSON'))
    .action((id, o) => guard('获取事件失败', async () => {
      const aid = parseId(id, 'id');
      const params = pageParams(o);
      const res = await apiClient.get(`${base(await orgOf(o))}/${aid}/events`, params);
      emit(o.json, res, () => renderEvents(res, params.page, params.pageSize));
    }));

  withOrg(automation.command('plans')
    .description('「计划」：组织的自动化 + 项目执行计划（不含报表计划 / 个人工作流），含待审批计数')
    .option('--source <source>', `来源 ${SOURCES.join('|')}（manual = 手动建的项目执行计划）；默认两者`)
    .option('--status <status>', '状态（自动化按定义状态，执行计划按计划状态）')
    .option('--project <id>', '按项目过滤')
    .option('--trigger <type>', '按自动化触发方式过滤（给出时不含执行计划）')
    .option('--keyword <text>', '名称关键字')
    .option('-p, --page <num>', '页码', '1')
    .option('--page-size <num>', '每页条数（1-100）', '20')
    .option('--json', '输出 JSON'))
    .action((o) => guard('获取计划失败', async () => {
      const params = buildPlansParams(o);
      const res = await apiClient.get(`${base(await orgOf(o))}/plans`, params);
      emit(o.json, res, () => renderPlans(res, Number(params.page), Number(params.pageSize)));
    }));

  const settings = automation.command('settings').description('组织自动化设置（成员可读，owner/admin 可改）');

  withOrg(settings.command('get')
    .description('查看组织自动化设置')
    .option('--json', '输出 JSON'))
    .action((o: OrgOpts) => guard('获取自动化设置失败', async () => {
      const res = await apiClient.get(`/api/v1/orgs/${await orgOf(o)}/automation-settings`);
      emit(o.json, res, () => renderSettings(res ?? {}));
    }));

  withOrg(settings.command('set')
    .description('修改组织自动化设置（只改给出的项；仅 owner/admin）')
    .option('--timezone <tz>', '组织时区（IANA，如 Asia/Tokyo）')
    .option('--require-enable-approval', '启用 / 修改已启用的自动化需审批')
    .option('--no-require-enable-approval', '启用无需审批')
    .option('--require-run-approval', '每次运行需审批')
    .option('--no-require-run-approval', '运行无需审批')
    .option('--run-approval-timeout <hours>', '运行审批超时 1-168 小时')
    .option('--member-can-edit', '成员可新建 / 编辑 / 删除自动化')
    .option('--no-member-can-edit', '仅 owner/admin 可新建 / 编辑 / 删除')
    .option('--json', '输出 JSON'))
    .action((o: SettingsFlags & OrgOpts) => guard('修改自动化设置失败', async () => {
      const body = buildSettingsBody(o);
      const res = await apiClient.put(`/api/v1/orgs/${await orgOf(o)}/automation-settings`, body);
      emit(o.json, res, () => `✓ 已更新\n${renderSettings(res ?? {})}`);
    }));
}
