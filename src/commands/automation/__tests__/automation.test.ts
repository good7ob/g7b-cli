/** prd-0135 FP-7 / backend #989: `good7ob automation`. HTTP stubbed at the axios instance via the shared harness. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clock, registerAutomationCommands } from '../index';
import { buildTrigger, parseWeekdays } from '../input';
import { describeAutomationError } from '../render';
import configService from '../../../services/ConfigService';
import { Envelope, bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const ORG = 3;
const BASE = `/api/v1/orgs/${ORG}/automations`;

const VO = {
  id: 12, orgId: ORG, name: '夜间开发', status: 'enabled', displayStatus: 'ENABLED',
  trigger: { type: 'PERIODIC', cronExpr: '0 22 * * 1,3', timeZone: 'Asia/Tokyo', display: '每周一、三 22:00',
    periodic: { kind: 'WEEKLY', weekdays: [1, 3], time: '22:00' }, graceMinutes: 10, skipNotifyThreshold: 3, consecutiveSkips: 0 },
  nextRunAt: '2026-10-29 22:00:00',
  target: { type: 'TASK_FILTER', projectId: 7, projectName: '官网', taskFilter: { labels: ['auto'] }, maxTasksPerRun: 1,
    workflowTemplateCode: 'BUILTIN_LINEAR_V1', matchingTaskCount: 4 },
  failurePolicy: 'STOP',
  budget: { runTokenBudget: 200000, dailyTokenBudget: 1000000, stepTimeoutMinutes: 120, runTimeoutMinutes: 480, todayUsedTokens: 0 },
  billing: { subject: 'ORG_POOL', enabledBy: 11, enabledByName: '甲', enabledAt: '2026-10-29 09:00:00', confirmEmployeeId: 5,
    runApprovalRequired: false, effectiveRunApproval: 'not_required', runApprovalSource: 'ORG' },
  lastRun: { runId: 345, result: 'SUCCEEDED', at: '2026-10-28 22:00:00' },
  definitionVersion: 3,
  permissions: { canEdit: true, canEnable: true, canRun: true, canDelete: false },
  recentRuns: [
    { kind: 'RUN', runId: 345, status: 'completed', triggerType: 'PERIODIC', triggerChannel: 'SYSTEM', at: '2026-10-28 22:00:00', actualStartAt: '2026-10-28 22:00:05' },
    { kind: 'SKIPPED', status: 'SKIPPED', triggerType: 'PERIODIC', reasonCode: 'NO_TASKS', at: '2026-10-27 22:00:00' },
  ],
  recentEvents: [{ id: 9, eventType: 'ENABLED', operatorType: 'HUMAN', operatorId: 11, channel: 'CLI', createdAt: '2026-10-29 09:00:00' }],
};

const auto = (args: string[], response: Envelope | ((m: string, url: string) => Envelope) = ok(VO)) =>
  runCli(registerAutomationCommands, ['automation', ...args], response as never);

beforeEach(() => {
  process.env.GOOD7OB_ORG_ID = String(ORG);
});
afterEach(() => {
  delete process.env.GOOD7OB_ORG_ID;
  vi.restoreAllMocks();
});

async function expectRejected(args: string[], needle: string) {
  const r = await auto(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
  return r;
}

const posted = (r: Awaited<ReturnType<typeof auto>>) => r.http.post.mock.calls[0];

// ── create: arg → payload per trigger type ──

describe('automation create', () => {
  const create = (extra: string[], response = ok({ ...VO, id: 21, status: 'draft' })) =>
    auto(['create', '--name', ' 夜间开发 ', '--project', '7', ...extra], response);

  it('cron: trimmed name, normalised five-field cron, TASK_FILTER target, no optional sections', async () => {
    const r = await create(['--trigger', 'cron', '--cron', '0  22 * *   1-5']);
    expect(posted(r)).toEqual([BASE, {
      name: '夜间开发',
      trigger: { type: 'CRON', cronExpr: '0 22 * * 1-5' },
      target: { type: 'TASK_FILTER', projectId: 7 },
    }]);
    expect(r.stdout).toContain('✓ 已新建自动化 #21「夜间开发」（draft）');
    expect(r.stdout).toContain('good7ob automation enable 21');
  });

  it('periodic weekly: day names → 1-7 sorted, H:mm padded, timezone kept', async () => {
    const r = await create(['--trigger', 'periodic', '--every', 'weekly', '--weekday', 'wed,mon,mon', '--at', '9:30', '--timezone', 'Asia/Shanghai']);
    expect(posted(r)[1].trigger).toEqual({
      type: 'PERIODIC', periodic: { kind: 'WEEKLY', time: '09:30', weekdays: [1, 3] }, timeZone: 'Asia/Shanghai',
    });
  });

  it('periodic monthly last day / daily', async () => {
    const m = await create(['--trigger', 'periodic', '--every', 'monthly', '--day', 'last', '--at', '23:00']);
    expect(posted(m)[1].trigger.periodic).toEqual({ kind: 'MONTHLY', time: '23:00', monthDay: 'LAST' });
    const d = await create(['--trigger', 'periodic', '--every', 'daily', '--at', '06:00']);
    expect(posted(d)[1].trigger.periodic).toEqual({ kind: 'DAILY', time: '06:00' });
  });

  it('task-pool: interval, cross-midnight window with weekdays, grace; filter flags; caps; billing', async () => {
    const r = await create(['--trigger', 'task-pool', '--pool-interval', '15', '--window', '22:00-06:00', '--window-weekday', '1,2,3,4,5',
      '--grace', '20', '--tags', 'auto,night', '--priority', 'HIGH,urgent', '--executor', '5', '--max-tasks', '3',
      '--budget-tokens', '50000', '--daily-budget-tokens', '400000', '--billing', 'byok', '--description', '夜里跑']);
    expect(posted(r)[1]).toEqual({
      name: '夜间开发',
      description: '夜里跑',
      trigger: { type: 'TASK_POOL', poolMinIntervalMinutes: 15, window: { start: '22:00', end: '06:00', weekdays: [1, 2, 3, 4, 5] }, graceMinutes: 20 },
      target: { type: 'TASK_FILTER', projectId: 7, taskFilter: { labels: ['auto', 'night'], priorities: ['high', 'urgent'], executorEmployeeId: 5 }, maxTasksPerRun: 3 },
      budget: { runTokenBudget: 50000, dailyTokenBudget: 400000 },
      billing: { subject: 'BYOK' },
    });
  });

  it('manual + --task-filter JSON; a lone --budget-tokens sends the daily cap as unlimited (null)', async () => {
    const r = await create(['--trigger', 'manual', '--task-filter', '{"priorities":["high"]}', '--budget-tokens', '1000', '--billing', 'org-pool']);
    expect(posted(r)[1]).toMatchObject({
      trigger: { type: 'MANUAL' },
      target: { projectId: 7, taskFilter: { priorities: ['high'] } },
      budget: { runTokenBudget: 1000, dailyTokenBudget: null },
      billing: { subject: 'ORG_POOL' },
    });
  });

  it.each([['event'], ['EVENT'], ['Event']])('rejects --trigger %s client-side with 第二期 (no HTTP)', async (t) => {
    await expectRejected(['create', '--name', 'x', '--project', '7', '--trigger', t], '第二期');
  });

  it.each([
    ['unknown trigger', ['--trigger', 'hourly'], '--trigger'],
    ['cron with four fields', ['--trigger', 'cron', '--cron', '0 22 * *'], '五段'],
    ['cron without --cron', ['--trigger', 'cron'], '--cron'],
    ['--cron on a periodic trigger', ['--trigger', 'periodic', '--every', 'daily', '--at', '01:00', '--cron', '* * * * *'], '--cron'],
    ['periodic without --at', ['--trigger', 'periodic', '--every', 'daily'], '--at'],
    ['weekly without --weekday', ['--trigger', 'periodic', '--every', 'weekly', '--at', '01:00'], '--weekday'],
    ['--weekday on daily', ['--trigger', 'periodic', '--every', 'daily', '--at', '01:00', '--weekday', '1'], '--weekday'],
    ['weekday 8', ['--trigger', 'periodic', '--every', 'weekly', '--at', '01:00', '--weekday', '8'], '--weekday'],
    ['monthly day 29', ['--trigger', 'periodic', '--every', 'monthly', '--at', '01:00', '--day', '29'], '--day'],
    ['bad time', ['--trigger', 'periodic', '--every', 'daily', '--at', '24:00'], '--at'],
    ['bad time zone', ['--trigger', 'cron', '--cron', '0 1 * * *', '--timezone', 'Mars/Base'], '--timezone'],
    ['--pool-interval on cron', ['--trigger', 'cron', '--cron', '0 1 * * *', '--pool-interval', '10'], '--pool-interval'],
    ['pool interval 4', ['--trigger', 'task-pool', '--pool-interval', '4'], '--pool-interval'],
    ['window start = end', ['--trigger', 'manual', '--window', '01:00-01:00'], '--window'],
    ['window weekday without window', ['--trigger', 'manual', '--window-weekday', '1'], '--window-weekday'],
    ['task filter JSON and flags', ['--trigger', 'manual', '--task-filter', '{}', '--tags', 'a'], '--task-filter'],
    ['task filter not JSON', ['--trigger', 'manual', '--task-filter', 'labels=a'], 'JSON'],
    ['task filter unknown key', ['--trigger', 'manual', '--task-filter', '{"status":"todo"}'], 'status'],
    ['max tasks 21', ['--trigger', 'manual', '--max-tasks', '21'], '--max-tasks'],
    ['run cap above daily cap', ['--trigger', 'manual', '--budget-tokens', '10', '--daily-budget-tokens', '5'], '当日上限'],
    ['budget 0', ['--trigger', 'manual', '--budget-tokens', '0'], '--budget-tokens'],
    ['billing other', ['--trigger', 'manual', '--billing', 'card'], '--billing'],
  ])('rejects %s before calling the API', (_n, args, needle) =>
    expectRejected(['create', '--name', 'x', '--project', '7', ...args], needle));

  it('requires --name / --project / --trigger (commander)', async () => {
    const r = await auto(['create', '--project', '7', '--trigger', 'manual']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("required option '--name <name>'");
    expect(noHttpCalls(r)).toBe(true);
  });

  it('maps 1006 by its key and 2706 / 2705 / 2724 by code', async () => {
    const dup = await create(['--trigger', 'manual'], bizError(1006, 'AUTOMATION_NAME_DUPLICATE: name: 组织内已有同名自动化「夜间开发」'));
    expect(dup.exitCode).toBe(1);
    expect(dup.stderr).toContain('✗ 新建自动化失败: 组织内已有同名自动化，请换一个 --name [1006: AUTOMATION_NAME_DUPLICATE');
    expect((await create(['--trigger', 'cron', '--cron', '*/2 * * * *'], bizError(2706, 'TRIGGER_INVALID: cronExpr: 两次触发间隔不能小于 5 分钟'))).stderr)
      .toContain('触发器不合法');
    expect((await create(['--trigger', 'manual'], bizError(2705, 'AUTOMATION_TARGET_INVALID: 项目 #7 已归档'))).stderr).toContain('目标无效');
    expect((await create(['--trigger', 'manual'], bizError(2724, 'BUDGET_INVALID: x'))).stderr).toContain('预算不合法');
  });

  it('prints the created VO with --json', async () => {
    expect(JSON.parse((await create(['--trigger', 'manual', '--json'])).stdout).id).toBe(21);
  });
});

// ── update: read, merge the touched sections, write them whole ──

describe('automation update', () => {
  const reply = (put: unknown = { ...VO, definitionVersion: 4 }, orgTz = 'Asia/Tokyo') => (m: string, url: string): Envelope => {
    if (m === 'get' && url.endsWith('/automation-settings')) return ok({ orgId: ORG, timeZone: orgTz });
    if (m === 'get') return ok(VO);
    return ok(put);
  };
  const putBody = (r: Awaited<ReturnType<typeof auto>>) => r.http.put.mock.calls[0];

  it('--max-tasks resends the whole target (project, filter, template) with the new value', async () => {
    const r = await auto(['update', '12', '--max-tasks', '3'], reply());
    expect(r.http.get).toHaveBeenCalledWith(`${BASE}/12`, { params: undefined });
    expect(putBody(r)).toEqual([`${BASE}/12`, {
      target: { type: 'TASK_FILTER', projectId: 7, taskFilter: { labels: ['auto'] }, maxTasksPerRun: 3, workflowTemplateCode: 'BUILTIN_LINEAR_V1' },
    }]);
    expect(r.stdout).toContain('✓ 自动化 #12 已更新（enabled）');
  });

  it('--budget-tokens keeps the daily cap and timeouts', async () => {
    const r = await auto(['update', '12', '--budget-tokens', '5000'], reply());
    expect(putBody(r)[1]).toEqual({ budget: { runTokenBudget: 5000, dailyTokenBudget: 1000000, stepTimeoutMinutes: 120, runTimeoutMinutes: 480 } });
  });

  it('--at keeps weekly weekdays; an org-inherited zone is not pinned', async () => {
    const r = await auto(['update', '12', '--at', '23:15'], reply());
    expect(putBody(r)[1]).toEqual({
      trigger: { type: 'PERIODIC', periodic: { kind: 'WEEKLY', time: '23:15', weekdays: [1, 3] }, graceMinutes: 10, skipNotifyThreshold: 3 },
    });
  });

  it('keeps an explicit zone that differs from the org zone; switching to cron drops periodic', async () => {
    const r = await auto(['update', '12', '--trigger', 'cron', '--cron', '30 1 * * *'], reply(undefined, 'Asia/Shanghai'));
    expect(putBody(r)[1].trigger).toEqual({ type: 'CRON', cronExpr: '30 1 * * *', timeZone: 'Asia/Tokyo', graceMinutes: 10, skipNotifyThreshold: 3 });
  });

  it('--billing keeps confirmEmployeeId and the run-approval flag; name / description pass through', async () => {
    const r = await auto(['update', '12', '--billing', 'byok', '--name', '新名', '--description', ''], reply());
    expect(putBody(r)[1]).toEqual({ name: '新名', description: '', billing: { subject: 'BYOK', confirmEmployeeId: 5, runApprovalRequired: false } });
  });

  it('reports a change parked for approval', async () => {
    const r = await auto(['update', '12', '--max-tasks', '2'], reply({ ...VO, status: 'awaiting_approval', pendingApprovalId: 88, pendingChangeKind: 'UPDATE' }));
    expect(r.stdout).toContain('已提交审批 #88（UPDATE），批准后生效');
  });

  it('rejects --trigger event before any call, and an empty update after reading', async () => {
    await expectRejected(['update', '12', '--trigger', 'event'], '第二期');
    const none = await auto(['update', '12'], reply());
    expect(none.exitCode).toBe(1);
    expect(none.stderr).toContain('没有要修改的内容');
    expect(none.http.put).not.toHaveBeenCalled();
  });

  it('2702 while awaiting approval → exit 3', async () => {
    const r = await auto(['update', '12', '--name', 'x'], (m) => (m === 'get' ? ok(VO) : bizError(2702, 'AUTOMATION_INVALID_STATE: 审批中的自动化不能编辑，请先撤回审批（当前 awaiting_approval）')));
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain('withdraw-approval');
  });
});

// ── read commands: table vs json ──

describe('automation list', () => {
  const page = ok({
    list: [
      { ...VO, displayStatus: 'RUNNING' },
      { id: 13, name: '任务池', status: 'paused', pausedReason: 'MANUAL', trigger: { type: 'TASK_POOL', display: '任务池（每 10 分钟）' }, target: { projectId: 8 } },
      { id: 14, name: null, status: 'draft' },
    ],
    total: 23, page: 1, pageSize: 20,
  });

  it('sends paging defaults to the org path and renders the PRD columns', async () => {
    const r = await auto(['list'], page);
    expect(r.http.get).toHaveBeenCalledWith(BASE, { params: { page: 1, pageSize: 20 } });
    expect(r.stdout).toMatch(/ID\s+名称\s+状态\s+触发方式\s+下次运行\s+最近结果\s+项目/);
    expect(r.stdout).toMatch(/12\s+夜间开发\s+enabled · 运行中\s+每周一、三 22:00\s+2026-10-29 22:00:00\s+SUCCEEDED #345\s+#7 官网/);
    expect(r.stdout).toMatch(/13\s+任务池\s+paused\(MANUAL\)\s+任务池（每 10 分钟）\s+—\s+—\s+#8/);
    expect(r.stdout).toMatch(/14\s+—\s+draft\s+—\s+—\s+—\s+—/);
    expect(r.stdout).toContain('共 23 条，第 1/2 页');
  });

  it('passes filters; --json prints the raw page; empty message', async () => {
    const r = await auto(['list', '--status', 'Enabled', '--project', '7', '--trigger', 'task-pool', '--keyword', '夜', '-p', '2', '--page-size', '50', '--org-id', '9'], page);
    expect(r.http.get).toHaveBeenCalledWith('/api/v1/orgs/9/automations', {
      params: { page: 2, pageSize: 50, status: 'enabled', projectId: 7, triggerType: 'TASK_POOL', keyword: '夜' },
    });
    expect(JSON.parse((await auto(['list', '--json'], page)).stdout).total).toBe(23);
    expect((await auto(['list'], ok({ list: [], total: 0 }))).stdout).toContain('没有符合条件的自动化');
  });

  it('rejects a bad status / page size', async () => {
    await expectRejected(['list', '--status', 'running'], '--status');
    await expectRejected(['list', '--page-size', '101'], '--page-size');
  });

  it('maps 2004 (not a member) and 2000 (employee-key capability filter)', async () => {
    expect((await auto(['list'], bizError(2004, 'Access denied'))).stderr).toContain('无权操作');
    expect((await auto(['list'], bizError(2000, '该 AI 员工无权访问该接口: GET /api/v1/orgs/3/automations'))).stderr)
      .toContain('无权访问该接口：AI 员工 Key 只开放自动化的只读接口');
  });
});

describe('automation show', () => {
  it('shows trigger, next run, target, budget, billing and the recent runs incl. skips', async () => {
    const r = await auto(['show', '12']);
    expect(r.http.get).toHaveBeenCalledWith(`${BASE}/12`, { params: undefined });
    expect(r.stdout).toContain('自动化 #12  夜间开发');
    expect(r.stdout).toContain('触发:     每周一、三 22:00（PERIODIC，cron 0 22 * * 1,3，时区 Asia/Tokyo）');
    expect(r.stdout).toContain('下次运行: 2026-10-29 22:00:00');
    expect(r.stdout).toContain('最近结果: SUCCEEDED #345 @ 2026-10-28 22:00:00');
    expect(r.stdout).toContain('目标:     项目 #7 官网；标签 auto；每次最多 1 个任务；当前匹配 4 个');
    expect(r.stdout).toContain('预算:     单次 200000 Token / 当日 1000000 Token（今日已用 0）');
    expect(r.stdout).toContain('计费:     ORG_POOL；启用人 甲(#11) @ 2026-10-29 09:00:00；每次运行需审批 否（ORG）');
    expect(r.stdout).toContain('我能:     编辑 是 / 启用 是 / 运行 是 / 删除 否');
    expect(r.stdout).toMatch(/RUN\s+#345\s+completed\s+PERIODIC\s+SYSTEM/);
    expect(r.stdout).toMatch(/SKIPPED\s+—\s+SKIPPED\s+PERIODIC\s+—\s+NO_TASKS/);
    expect(r.stdout).toMatch(/9\s+ENABLED\s+—\s+—\s+HUMAN:11\s+CLI/);
  });

  it('flags runner warning / pending approval; --json passes the VO; 1002 mapped', async () => {
    const r = await auto(['show', '12'], ok({ ...VO, runnerWarning: true, pendingApprovalId: 88, pendingChangeKind: 'ENABLE', recentRuns: [] }));
    expect(r.stdout).toContain('⚠ 当前没有在线且有空槽的 Runner');
    expect(r.stdout).toContain('审批中:   审批 #88（ENABLE）');
    expect(r.stdout).toContain('（暂无）');
    expect(JSON.parse((await auto(['show', '12', '--json'])).stdout).target.matchingTaskCount).toBe(4);
    expect((await auto(['show', '99'], bizError(1002, '自动化不存在：99'))).stderr).toContain('自动化或组织不存在');
    await expectRejected(['show', 'abc'], 'id');
  });
});

// ── run / lifecycle ──

describe('automation run', () => {
  it('POSTs /run and shows run id = plan id, status and tasks', async () => {
    const r = await auto(['run', '12'], ok({ runId: 501, status: 'scheduled', taskIds: [70, 71] }));
    expect(r.http.post).toHaveBeenCalledWith(`${BASE}/12/run`, undefined);
    expect(r.stdout).toContain('✓ 自动化 #12 已创建运行 #501（执行计划 #501），状态 scheduled');
    expect(r.stdout).toContain('任务: #70, #71');
    expect(r.exitCode).toBeUndefined();
  });

  it('awaiting_approval run says so; --json prints the result', async () => {
    const r = await auto(['run', '12'], ok({ runId: 502, status: 'awaiting_approval', taskIds: [] }));
    expect(r.stdout).toContain('该运行需审批');
    expect(JSON.parse((await auto(['run', '12', '--json'], ok({ runId: 501, status: 'scheduled' }))).stdout).runId).toBe(501);
  });

  it.each([
    [2708, 'CONCURRENT_RUN: 运行 #500 尚未结束', '已有进行中的运行'],
    [2710, 'NO_RUNNER: 目标岗位当前没有在线且有空槽的 Runner', 'Runner'],
    [2711, 'NO_TASKS: 目标项目没有符合条件的待 AI 执行（pending_agent）任务', 'pending_agent'],
    [2709, 'BUDGET_EXHAUSTED', '预算已用尽'],
    [2702, 'AUTOMATION_INVALID_STATE: 只有已启用或已暂停的自动化可以手动运行（当前 draft）', '当前状态不允许'],
  ])('code %s → exit 3 (skipped / conflict) with a readable reason', async (code, msg, needle) => {
    const r = await auto(['run', '12'], bizError(code, msg));
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain(needle);
    expect(r.stderr).toContain(`[${code}: ${msg}]`);
  });

  it('2703 (AI employee key) → exit 1', async () => {
    const r = await auto(['run', '12'], bizError(2703, 'AUTOMATION_AI_FORBIDDEN: AI 员工 Key 对自动化只有读权限'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('AI 员工 Key 对自动化只有只读权限');
  });

  describe('--wait', () => {
    let now = 0;
    beforeEach(() => {
      now = 0;
      vi.spyOn(clock, 'now').mockImplementation(() => now);
      vi.spyOn(clock, 'sleep').mockImplementation(async (ms: number) => void (now += ms));
    });

    const waiting = (statuses: string[]) => {
      let i = 0;
      return (m: string, url: string): Envelope => {
        if (m === 'post') return ok({ runId: 501, status: 'scheduled', taskIds: [70] });
        if (url.endsWith('/runs')) {
          const status = statuses[Math.min(i++, statuses.length - 1)];
          return ok({ list: [{ kind: 'SKIPPED', status: 'SKIPPED' }, { kind: 'RUN', runId: 501, status }] });
        }
        return ok(VO); // detail: graceMinutes 10
      };
    };

    it('polls the runs until the run starts → exit 0', async () => {
      const r = await auto(['run', '12', '--wait'], waiting(['scheduled', 'scheduled', 'running']));
      expect(r.http.get).toHaveBeenCalledWith(`${BASE}/12/runs`, { params: { page: 1, pageSize: 20 } });
      expect(r.stdout).toContain('等待开始（最长 10 分钟）');
      expect(r.stdout).toContain('✓ 运行 #501 已开始（running）');
      expect(r.exitCode).toBeUndefined();
    });

    it('cancelled → exit 3; timeout (--wait-timeout) → exit 3', async () => {
      const cancelled = await auto(['run', '12', '--wait'], waiting(['cancelled']));
      expect(cancelled.exitCode).toBe(3);
      expect(cancelled.stderr).toContain('未执行（cancelled）');
      const timeout = await auto(['run', '12', '--wait', '--wait-timeout', '1'], waiting(['scheduled']));
      expect(timeout.exitCode).toBe(3);
      expect(timeout.stderr).toContain('1 分钟内没有开始');
      expect(JSON.parse((await auto(['run', '12', '--wait', '--json'], waiting(['running']))).stdout)).toMatchObject({ runId: 501, waitedStatus: 'running', started: true });
    });
  });
});

describe('automation enable / pause / resume / disable / withdraw-approval', () => {
  it.each([
    ['enable', '已启用'],
    ['pause', '已暂停'],
    ['resume', '已恢复'],
    ['disable', '已停用'],
  ])('%s POSTs /{id}/%s, with --reason as the body', async (verb, done) => {
    const plain = await auto([verb, '12']);
    expect(plain.http.post).toHaveBeenCalledWith(`${BASE}/12/${verb}`, undefined);
    expect(plain.stdout).toContain(`✓ 自动化 #12 ${done}（enabled）`);
    const why = await auto([verb, '12', '--reason', '夜间维护']);
    expect(why.http.post).toHaveBeenCalledWith(`${BASE}/12/${verb}`, { reason: '夜间维护' });
  });

  it('enable shows billing + run cap + next run; or the approval it opened', async () => {
    const r = await auto(['enable', '12']);
    expect(r.stdout).toContain('计费 ORG_POOL，单次上限 200000 Token，下次运行 2026-10-29 22:00:00');
    const parked = await auto(['enable', '12'], ok({ ...VO, status: 'awaiting_approval', pendingApprovalId: 77, pendingChangeKind: 'ENABLE' }));
    expect(parked.stdout).toContain('已提交审批 #77（ENABLE）');
  });

  it('enable on an EVENT draft: 1001 + EVENT_TRIGGER_PHASE2 → 第二期 message', async () => {
    const r = await auto(['enable', '12'], bizError(1001, 'EVENT_TRIGGER_PHASE2: trigger.type: 事件触发第二期提供'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('事件触发（EVENT）属第二期：可以存为草稿，但不能启用 [1001: EVENT_TRIGGER_PHASE2');
  });

  it.each([
    [2704, '计费主体不可用'], [2712, 'DEV'], [2726, '工作流模板'], [2004, '仅组织 owner/admin'],
  ])('enable maps %s', async (code, needle) => {
    expect((await auto(['enable', '12'], bizError(code, 'x'))).stderr).toContain(needle);
  });

  it('pause from draft: 2702 → exit 3', async () => {
    expect((await auto(['pause', '12'], bizError(2702, 'AUTOMATION_INVALID_STATE: x'))).exitCode).toBe(3);
  });

  it('withdraw-approval POSTs without a body', async () => {
    const r = await auto(['withdraw-approval', '12'], ok({ ...VO, status: 'draft' }));
    expect(r.http.post).toHaveBeenCalledWith(`${BASE}/12/withdraw-approval`, undefined);
    expect(r.stdout).toContain('✓ 自动化 #12 已撤回审批（draft）');
  });
});

describe('automation delete', () => {
  it('--yes DELETEs', async () => {
    const r = await auto(['delete', '12', '--yes'], ok(null));
    expect(r.http.delete).toHaveBeenCalledWith(`${BASE}/12`, undefined);
    expect(r.stdout).toContain('✓ 已删除自动化 #12');
  });

  it('refuses without --yes when not interactive; maps 2707', async () => {
    const isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    try {
      const r = await auto(['delete', '12'], ok(null));
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('--yes');
      expect(r.http.delete).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: isTTY, configurable: true });
    }
    expect((await auto(['delete', '12', '-y'], bizError(2707, 'AUTOMATION_HAS_ACTIVE_RUN: 运行 #5 尚未结束'))).stderr).toContain('未结束的运行');
  });
});

// ── preview / runs / events / plans / settings ──

describe('automation preview', () => {
  const PREVIEW = ok({
    triggerType: 'CRON', timeZone: 'Asia/Shanghai', cronExpr: '0 22 * * 1-5', display: 'cron 0 22 * * 1-5',
    next: ['2026-10-29 23:00:00', '2026-10-30 23:00:00'], nextLocal: ['2026-10-29T22:00+08:00', '2026-10-30T22:00+08:00'],
    inWindow: [true, false], note: 'next 为平台时间（JST），nextLocal 为触发器时区',
  });

  it('cron body + table of fire times', async () => {
    const r = await auto(['preview', '--cron', '0 22 * * 1-5', '--timezone', 'Asia/Shanghai', '--window', '21:00-23:30', '--count', '2'], PREVIEW);
    expect(r.http.post).toHaveBeenCalledWith(`${BASE}/trigger-preview`, {
      triggerType: 'CRON', cronExpr: '0 22 * * 1-5', timeZone: 'Asia/Shanghai', window: { start: '21:00', end: '23:30' }, count: 2,
    });
    expect(r.stdout).toContain('触发: cron 0 22 * * 1-5（CRON，cron 0 22 * * 1-5，时区 Asia/Shanghai）');
    expect(r.stdout).toMatch(/1\s+2026-10-29 23:00:00\s+2026-10-29T22:00\+08:00\s+是/);
    expect(r.stdout).toMatch(/2\s+2026-10-30 23:00:00\s+2026-10-30T22:00\+08:00\s+否/);
  });

  it('periodic body; default count 5; --json', async () => {
    const r = await auto(['preview', '--every', 'weekly', '--weekday', 'mon,wed', '--at', '22:00', '--json'], PREVIEW);
    expect(r.http.post).toHaveBeenCalledWith(`${BASE}/trigger-preview`, {
      triggerType: 'PERIODIC', periodic: { kind: 'WEEKLY', time: '22:00', weekdays: [1, 3] }, count: 5,
    });
    expect(JSON.parse(r.stdout).next).toHaveLength(2);
  });

  it('needs exactly one of --cron / --every; count 1-20; 2706 mapped', async () => {
    await expectRejected(['preview'], '--cron');
    await expectRejected(['preview', '--cron', '0 1 * * *', '--every', 'daily'], '--cron');
    await expectRejected(['preview', '--cron', '0 1 * * *', '--count', '21'], '--count');
    expect((await auto(['preview', '--cron', '*/2 * * * *'], bizError(2706, 'TRIGGER_INVALID: cronExpr: 两次触发间隔不能小于 5 分钟'))).stderr)
      .toContain('触发器不合法');
  });
});

describe('automation runs / events / plans', () => {
  it('runs: status filter + paging, RUN and SKIPPED rows', async () => {
    const r = await auto(['runs', '12', '--status', 'Running', '--page-size', '5'], ok({ list: VO.recentRuns, page: 1, pageSize: 5 }));
    expect(r.http.get).toHaveBeenCalledWith(`${BASE}/12/runs`, { params: { page: 1, pageSize: 5, status: 'running' } });
    expect(r.stdout).toMatch(/类型\s+运行ID\s+状态\s+触发\s+渠道\s+原因\s+时间\s+开始于/);
    expect(r.stdout).toMatch(/RUN\s+#345\s+completed/);
    expect((await auto(['runs', '12'], ok({ list: [] }))).stdout).toContain('还没有运行或跳过记录');
  });

  it('events: paging and total', async () => {
    const r = await auto(['events', '12', '-p', '2'], ok({ list: VO.recentEvents, total: 21, page: 2, pageSize: 20 }));
    expect(r.http.get).toHaveBeenCalledWith(`${BASE}/12/events`, { params: { page: 2, pageSize: 20 } });
    expect(r.stdout).toContain('共 21 条，第 2/2 页');
  });

  const PLANS = ok({
    list: [
      { kind: 'AUTOMATION', automation: VO, actions: ['run', 'pause', 'edit'], recentRuns: [] },
      { kind: 'EXECUTION_PLAN', plan: { id: 40, name: '手动计划', projectId: 7, projectName: '官网', status: 'scheduled', trigger: '一次性', nextRunAt: '2026-10-30 09:00:00' }, actions: ['start', 'edit', 'cancel'] },
    ],
    total: 2, page: 1, pageSize: 20, summary: { needsApproval: 1, awaitingApprovalRuns: 2 },
  });

  it('plans: --source manual → EXECUTION_PLAN; both kinds rendered with the approval counts', async () => {
    const r = await auto(['plans', '--source', 'manual', '--status', 'scheduled'], PLANS);
    expect(r.http.get).toHaveBeenCalledWith(`${BASE}/plans`, { params: { page: 1, pageSize: 20, source: 'EXECUTION_PLAN', status: 'scheduled' } });
    expect(r.stdout).toMatch(/自动化\s+12\s+夜间开发\s+enabled\s+每周一、三 22:00\s+2026-10-29 22:00:00\s+#7 官网\s+run,pause,edit/);
    expect(r.stdout).toMatch(/执行计划\s+40\s+手动计划\s+scheduled\s+一次性\s+2026-10-30 09:00:00\s+#7 官网\s+start,edit,cancel/);
    expect(r.stdout).toContain('待审批的自动化 1 个，待审批的运行 2 个');
    const a = await auto(['plans', '--source', 'automation'], PLANS);
    expect(a.http.get).toHaveBeenCalledWith(`${BASE}/plans`, { params: { page: 1, pageSize: 20, source: 'AUTOMATION' } });
    expect(JSON.parse((await auto(['plans', '--json'], PLANS)).stdout).summary.needsApproval).toBe(1);
    await expectRejected(['plans', '--source', 'report'], '--source');
  });
});

describe('automation settings', () => {
  const SETTINGS = ok({
    orgId: ORG, timeZone: 'Asia/Tokyo', enableRequiresApproval: true, runApprovalRequired: false,
    runApproval: { effective: 'not_required', source: 'ORG', note: 'N-6 落地前由本设置提供' }, runApprovalTimeoutHours: 24,
    memberCanEdit: false, leaseMinutes: 15, runnerReminderMinutes: 30, logRetentionDays: 30, balanceByTokens: false, stepRetryLimit: 3, canEdit: false,
  });

  it('get renders the settings', async () => {
    const r = await auto(['settings', 'get'], SETTINGS);
    expect(r.http.get).toHaveBeenCalledWith(`/api/v1/orgs/${ORG}/automation-settings`, { params: undefined });
    expect(r.stdout).toContain('（只读：仅 owner/admin 可修改）');
    expect(r.stdout).toContain('启用需审批:         是');
    expect(r.stdout).toContain('每次运行需审批:     否（生效: not_required，来源 ORG）');
  });

  it('set sends only the given fields; --no-* sends false', async () => {
    const r = await auto(['settings', 'set', '--timezone', 'Asia/Shanghai', '--require-enable-approval', '--no-require-run-approval',
      '--run-approval-timeout', '48', '--no-member-can-edit'], SETTINGS);
    expect(r.http.put).toHaveBeenCalledWith(`/api/v1/orgs/${ORG}/automation-settings`, {
      timeZone: 'Asia/Shanghai', enableRequiresApproval: true, runApprovalRequired: false, runApprovalTimeoutHours: 48, memberCanEdit: false,
    });
    const one = await auto(['settings', 'set', '--require-run-approval'], SETTINGS);
    expect(one.http.put).toHaveBeenCalledWith(`/api/v1/orgs/${ORG}/automation-settings`, { runApprovalRequired: true });
  });

  it('set rejects nothing / bad values; 2004 mapped', async () => {
    await expectRejected(['settings', 'set'], '没有要修改的设置');
    await expectRejected(['settings', 'set', '--run-approval-timeout', '169'], '--run-approval-timeout');
    await expectRejected(['settings', 'set', '--timezone', 'Tokyo Time'], '--timezone');
    expect((await auto(['settings', 'set', '--require-run-approval'], bizError(2004, 'Access denied: insufficient role'))).stderr).toContain('无权操作');
  });
});

// ── organisation resolution ──

describe('organisation', () => {
  it('--org-id / --org beat GOOD7OB_ORG_ID', async () => {
    expect((await auto(['list', '--org-id', '9'], ok({ list: [] }))).http.get).toHaveBeenCalledWith('/api/v1/orgs/9/automations', expect.anything());
    expect((await auto(['list', '--org', '8'], ok({ list: [] }))).http.get).toHaveBeenCalledWith('/api/v1/orgs/8/automations', expect.anything());
    await expectRejected(['list', '--org-id', 'x'], '--org-id');
  });

  it('nothing configured: the only organisation of the key is used; several → asks for --org-id', async () => {
    delete process.env.GOOD7OB_ORG_ID;
    vi.spyOn(configService, 'get').mockReturnValue(undefined);
    const one = await auto(['list'], (_m, url) => (url === '/api/v1/orgs' ? ok({ list: [{ id: 5, name: 'Remo' }], total: 1 }) : ok({ list: [] })));
    expect(one.http.get).toHaveBeenCalledWith('/api/v1/orgs/5/automations', expect.anything());
    const many = await auto(['list'], ok({ list: [{ id: 5, name: 'Remo' }, { id: 6, name: 'Side' }] }));
    expect(many.exitCode).toBe(1);
    expect(many.stderr).toContain('你属于 2 个组织，请用 --org-id 指定：#5 Remo、#6 Side');
  });
});

// ── pure helpers ──

describe('helpers', () => {
  it('parseWeekdays accepts numbers and names, rejects junk', () => {
    expect(parseWeekdays('sun,1,Tuesday', 'x')).toEqual([1, 2, 7]);
    expect(() => parseWeekdays('mon1', 'x')).toThrow();
    expect(() => parseWeekdays('0', 'x')).toThrow();
  });

  it('buildTrigger keeps the window weekdays unless the window changes', () => {
    const baseT = { type: 'MANUAL', window: { start: '22:00', end: '06:00', weekdays: [1, 2] } };
    expect(buildTrigger({ grace: '5' }, baseT).window).toEqual({ start: '22:00', end: '06:00', weekdays: [1, 2] });
    expect(buildTrigger({ window: '20:00-21:00' }, baseT).window).toEqual({ start: '20:00', end: '21:00' });
    expect(buildTrigger({ window: 'none' }, baseT).window).toBeUndefined();
  });

  it('describeAutomationError: unknown code keeps the server text; INVALID_FIELD key', () => {
    const e = (code: number, msg: string) => Object.assign(new Error(msg), { code });
    expect(describeAutomationError(e(4242, 'weird'))).toBe('weird (code=4242)');
    expect(describeAutomationError(e(1001, 'INVALID_FIELD: name: 名称去空白后 1-100 字符'))).toBe('字段不合法 [1001: INVALID_FIELD: name: 名称去空白后 1-100 字符]');
    expect(describeAutomationError(e(1001, 'triggerType 必填'))).toBe('参数不合法 [1001: triggerType 必填]');
  });
});
