/** prd-0187 FP-7 (g7b #2839): window-loop definitions, spawn limits, preview / show and `automation draft`. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAutomationCommands } from '../index';
import { buildCreateBody, buildLoopFields, buildPreviewBody, buildSpawnLimits, buildUpdateBody } from '../input';
import { buildDraftListParams } from '../draft';
import { describeAutomationError } from '../render';
import { Envelope, bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const ORG = 3;
const BASE = `/api/v1/orgs/${ORG}/automations`;
const LOOP = ['--trigger', 'window-loop', '--window', '22:00-06:00', '--stop-accepting', '05:30', '--hard-deadline', '06:00'];

const LOOP_VO = {
  id: 12, name: '夜间长跑', status: 'enabled', definitionVersion: 2,
  trigger: {
    type: 'WINDOW_LOOP', display: '窗口长运行', timeZone: 'Asia/Tokyo', window: { start: '22:00', end: '06:00' },
    stopAcceptingAt: '05:30', hardDeadlineAt: '06:00', reserveMinutes: 20, maxConcurrency: 3, graceMinutes: 10,
  },
  target: { type: 'TASK_FILTER', projectId: 7, maxTasksPerRun: 200, workflowTemplateCode: 'BUILTIN_LINEAR_V1' },
  failurePolicy: 'CONTINUE', budget: { runTokenBudget: null, dailyTokenBudget: null },
  spawnLimits: { maxPerRun: 50, maxDepth: 1, maxPriority: 'medium', requireLink: true },
  loop: {
    phase: 'ACCEPTING', waitReason: 'WAITING_TASKS', windowStartAt: '2026-11-10 22:00:00',
    stopAcceptingAt: '2026-11-11 05:30:00', hardDeadlineAt: '2026-11-11 06:00:00', minutesToStopAccepting: 90, minutesToHardDeadline: 120,
  },
};

const auto = (args: string[], response: Envelope | ((m: string, url: string) => Envelope) = ok(LOOP_VO)) =>
  runCli(registerAutomationCommands, ['automation', ...args], response as never);
const created = (extra: string[], response: Envelope = ok({ ...LOOP_VO, status: 'draft' })) =>
  auto(['create', '--name', '夜间长跑', '--project', '7', ...extra], response);

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
}

describe('automation create --trigger window-loop', () => {
  it('builds the trigger section with the window-loop fields', async () => {
    const r = await created([...LOOP, '--max-concurrency', '5', '--reserve-minutes', '30', '--max-tasks-per-run', '500']);
    expect(r.exitCode).toBeUndefined();
    const [url, body] = r.http.post.mock.calls[0];
    expect(url).toBe(BASE);
    expect(body.trigger).toEqual({
      type: 'WINDOW_LOOP', window: { start: '22:00', end: '06:00' }, stopAcceptingAt: '05:30', hardDeadlineAt: '06:00',
      reserveMinutes: 30, maxConcurrency: 5,
    });
    expect(body.target.maxTasksPerRun).toBe(500);
    expect(body).not.toHaveProperty('spawnLimits');
  });

  it('--max-tasks takes the 1000 ceiling too; other triggers stay at 20', async () => {
    expect((await created([...LOOP, '--max-tasks', '1000'])).http.post.mock.calls[0][1].target.maxTasksPerRun).toBe(1000);
    await expectRejected(['create', '--name', 'n', '--project', '7', '--trigger', 'task-pool', '--max-tasks-per-run', '21'], '--max-tasks-per-run');
    await expectRejected(['create', '--name', 'n', '--project', '7', ...LOOP, '--max-tasks-per-run', '1001'], '--max-tasks-per-run');
  });

  it('refuses --max-tasks together with --max-tasks-per-run', async () => {
    await expectRejected(['create', '--name', 'n', '--project', '7', ...LOOP, '--max-tasks', '2', '--max-tasks-per-run', '3'], '同一个字段');
  });

  it.each([
    [['--trigger', 'window-loop', '--stop-accepting', '05:30', '--hard-deadline', '06:00'], '--window'],
    [['--trigger', 'window-loop', '--window', '22:00-06:00', '--hard-deadline', '06:00'], '--stop-accepting'],
    [['--trigger', 'window-loop', '--window', '22:00-06:00', '--stop-accepting', '05:30'], '--hard-deadline'],
    [['--trigger', 'window-loop', '--window', '22:00-06:00', '--stop-accepting', '12:00', '--hard-deadline', '06:00'], '不在运行窗口'],
    [['--trigger', 'window-loop', '--window', '22:00-06:00', '--stop-accepting', '05:30', '--hard-deadline', '05:00'], '不能早于'],
    [['--trigger', 'window-loop', '--window', '22:00-06:00', '--stop-accepting', '5pm', '--hard-deadline', '06:00'], '--stop-accepting'],
    [[...LOOP, '--max-concurrency', '21'], '--max-concurrency'],
    [[...LOOP, '--reserve-minutes', '1441'], '--reserve-minutes'],
  ])('rejects bad window-loop input locally %#', async (flags, needle) => {
    await expectRejected(['create', '--name', 'n', '--project', '7', ...flags], needle);
  });

  it('keeps the window-loop-only flags out of other triggers', async () => {
    await expectRejected(['create', '--name', 'n', '--project', '7', '--trigger', 'cron', '--cron', '0 22 * * *', '--stop-accepting', '05:30'], '--stop-accepting');
  });

  it('a hard deadline equal to the window end is allowed (crossing midnight too)', () => {
    expect(buildLoopFields({ stopAccepting: '05:30', hardDeadline: '06:00' }, { start: '22:00', end: '06:00' }))
      .toEqual({ stopAcceptingAt: '05:30', hardDeadlineAt: '06:00' });
    expect(buildLoopFields({ stopAccepting: '17:00', hardDeadline: '18:00' }, { start: '09:00', end: '18:00' }).hardDeadlineAt).toBe('18:00');
  });
});

describe('spawn limits', () => {
  it('sends only the given fields as spawnLimits (create)', async () => {
    const r = await created([...LOOP, '--spawn-max-per-run', '40', '--spawn-require-link', 'false']);
    expect(r.http.post.mock.calls[0][1].spawnLimits).toEqual({ maxPerRun: 40, requireLink: false });
  });

  it('update sends spawnLimits alone without touching the trigger / target', async () => {
    const r = await auto(['update', '12', '--spawn-max-depth', '0', '--spawn-max-priority', 'HIGH'], ok(LOOP_VO));
    expect(r.exitCode).toBeUndefined();
    expect(r.http.put.mock.calls[0][1]).toEqual({ spawnLimits: { maxDepth: 0, maxPriority: 'high' } });
  });

  it.each([
    [{ spawnMaxPerRun: '0' }, '--spawn-max-per-run'],
    [{ spawnMaxPerRun: '1001' }, '--spawn-max-per-run'],
    [{ spawnMaxDepth: '4' }, '--spawn-max-depth'],
    [{ spawnMaxDepth: '-1' }, '--spawn-max-depth'],
    [{ spawnMaxPriority: 'urgent' }, '--spawn-max-priority'],
    [{ spawnRequireLink: 'yes' }, '--spawn-require-link'],
  ])('rejects %j', (flags, needle) => expect(() => buildSpawnLimits(flags)).toThrow(needle));

  it('no --spawn flag, no spawnLimits', () => expect(buildSpawnLimits({})).toBeUndefined());
});

describe('automation update on a window-loop definition', () => {
  const update = (flags: string[]) => auto(['update', '12', ...flags], ok(LOOP_VO));

  it('--hard-deadline alone keeps the current stop-accepting / window / concurrency', async () => {
    const r = await update(['--hard-deadline', '05:45']);
    expect(r.exitCode).toBeUndefined();
    expect(r.http.put.mock.calls[0][1].trigger).toEqual(expect.objectContaining({
      type: 'WINDOW_LOOP', window: { start: '22:00', end: '06:00' }, stopAcceptingAt: '05:30', hardDeadlineAt: '05:45',
      reserveMinutes: 20, maxConcurrency: 3, timeZone: 'Asia/Tokyo', graceMinutes: 10,
    }));
  });

  it('--max-tasks-per-run alone is validated against the current window-loop type (1000)', async () => {
    const r = await update(['--max-tasks-per-run', '900']);
    expect(r.http.put.mock.calls[0][1].target.maxTasksPerRun).toBe(900);
    expect(r.http.put.mock.calls[0][1]).not.toHaveProperty('trigger');
  });

  it('moving the window so the stored times fall outside is refused locally', async () => {
    const r = await update(['--window', '09:00-12:00']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('不在运行窗口');
    expect(r.http.put).not.toHaveBeenCalled();
  });

  it('switching another trigger to window-loop needs the window-loop fields', () => {
    const current = { trigger: { type: 'CRON', cronExpr: '0 22 * * *', window: { start: '22:00', end: '06:00' } }, target: { projectId: 7 } };
    expect(() => buildUpdateBody({ trigger: 'window-loop' }, current)).toThrow('--stop-accepting');
    const body = buildUpdateBody({ trigger: 'window-loop', stopAccepting: '05:00', hardDeadline: '06:00' }, current);
    expect(body.trigger).toEqual({ type: 'WINDOW_LOOP', window: { start: '22:00', end: '06:00' }, stopAcceptingAt: '05:00', hardDeadlineAt: '06:00' });
  });

  it('create body for window-loop needs no cron fields', () => {
    expect(buildCreateBody({ name: 'n', project: '7', trigger: 'window-loop', window: '22:00-06:00', stopAccepting: '05:00', hardDeadline: '06:00' }).trigger)
      .not.toHaveProperty('cronExpr');
  });
});

describe('backend validation errors', () => {
  it('shows the INVALID_FIELD text from a 1001 and exits 1', async () => {
    const r = await created([...LOOP], bizError(1001, 'INVALID_FIELD: trigger.hardDeadlineAt: 早于停止接单') as Envelope);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('字段不合法');
    expect(r.stderr).toContain('trigger.hardDeadlineAt: 早于停止接单');
  });

  it('describes 2724 and 2703', () => {
    expect(describeAutomationError(Object.assign(new Error('x'), { code: 2724 }))).toContain('硬截止');
    expect(describeAutomationError(Object.assign(new Error('x'), { code: 2703 }))).toContain('只读权限');
  });
});

describe('automation preview --trigger window-loop', () => {
  const PREVIEW = {
    triggerType: 'WINDOW_LOOP', display: '窗口长运行', stopAcceptingOffsetMin: 450, hardDeadlineOffsetMin: 480,
    windows: [{ windowStart: '2026-11-10 22:00:00', stopAcceptingAt: '2026-11-11 05:30:00', hardDeadlineAt: '2026-11-11 06:00:00', windowEnd: '2026-11-11 06:00:00' }],
    next: ['2026-11-10 22:00:00'],
  };

  it('posts the window-loop request and shows window / stop-accepting / hard deadline', async () => {
    const r = await auto(['preview', ...LOOP, '--window-weekday', 'mon,tue', '--count', '3'], ok(PREVIEW));
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post.mock.calls[0][0]).toBe(`${BASE}/trigger-preview`);
    expect(r.http.post.mock.calls[0][1]).toEqual({
      triggerType: 'WINDOW_LOOP', window: { start: '22:00', end: '06:00', weekdays: [1, 2] },
      stopAcceptingAt: '05:30', hardDeadlineAt: '06:00', count: 3,
    });
    expect(r.stdout).toContain('2026-11-10 22:00:00');
    expect(r.stdout).toContain('2026-11-11 05:30:00');
    expect(r.stdout).toContain('停止接单');
    expect(r.stdout).toContain('硬截止');
  });

  it('cron preview is unchanged', () => expect(buildPreviewBody({ cron: '0 22 * * *' })).toEqual({ triggerType: 'CRON', cronExpr: '0 22 * * *', count: 5 }));

  it.each([
    [['--cron', '0 22 * * *', '--trigger', 'window-loop', '--window', '22:00-06:00', '--stop-accepting', '05:30', '--hard-deadline', '06:00'], '不能与'],
    [['--stop-accepting', '05:30', '--window', '22:00-06:00'], '--trigger window-loop'],
    [['--trigger', 'cron', '--cron', '0 22 * * *'], '--trigger window-loop'],
    [['--trigger', 'window-loop', '--stop-accepting', '05:30', '--hard-deadline', '06:00'], '--window'],
  ])('rejects %#', async (flags, needle) => expectRejected(['preview', ...flags], needle));
});

describe('automation show', () => {
  it('shows the loop object and the spawn limits', async () => {
    const r = await auto(['show', '12']);
    expect(r.stdout).toContain('停止接单 05:30，硬截止 06:00');
    expect(r.stdout).toContain('ACCEPTING（接单中）');
    expect(r.stdout).toContain('等待任务');
    expect(r.stdout).toContain('剩 90 分钟');
    expect(r.stdout).toContain('剩 120 分钟');
    expect(r.stdout).toContain('每次运行最多 50 个，深度 ≤ 1，优先级 ≤ medium，必须关联 是');
  });

  it('shows nothing extra for a plain definition', async () => {
    const r = await auto(['show', '12'], ok({ ...LOOP_VO, trigger: { type: 'CRON', display: '每天', cronExpr: '0 22 * * *' }, loop: null, spawnLimits: null }));
    expect(r.stdout).not.toContain('长运行');
    expect(r.stdout).not.toContain('自建限额');
  });
});

describe('automation draft', () => {
  const DRAFT = { id: 5, automationId: 12, runId: 7, title: '补测试', priority: 'medium', reason: 'QUOTA', status: 'pending', expiresAt: '2026-11-17 10:00:00', approvedTaskId: null };

  it('list sends the filters and renders the rows', async () => {
    const r = await auto(['draft', 'list', '--automation-id', '12', '--run-id', '7', '--status', 'Pending', '--limit', '20'], ok([DRAFT]));
    expect(r.http.get.mock.calls[0][0]).toBe(`${BASE}/task-drafts`);
    expect(r.http.get.mock.calls[0][1]).toEqual({ params: { automationId: 12, runId: 7, status: 'pending', limit: 20 } });
    expect(r.stdout).toContain('补测试');
    expect(r.stdout).toContain('QUOTA');
    expect(r.stdout).toContain('待处理 1');
  });

  it('list without filters sends no params and says so when empty', async () => {
    const r = await auto(['draft', 'list'], ok([]));
    expect(r.http.get.mock.calls[0][1]).toEqual({ params: {} });
    expect(r.stdout).toContain('没有符合条件的任务草案');
  });

  it.each([
    [['--status', 'done'], '--status'],
    [['--limit', '201'], '--limit'],
    [['--automation-id', 'x'], '--automation-id'],
    [['--run-id', '0'], '--run-id'],
  ])('list rejects %j', (flags, needle) => expect(() => buildDraftListParams({
    status: flags[0] === '--status' ? flags[1] : undefined, limit: flags[0] === '--limit' ? flags[1] : undefined,
    automationId: flags[0] === '--automation-id' ? flags[1] : undefined, runId: flags[0] === '--run-id' ? flags[1] : undefined,
  })).toThrow(needle));

  it('--json prints the data untouched', async () => {
    const r = await auto(['draft', 'list', '--json'], ok([DRAFT]));
    expect(JSON.parse(r.stdout)).toEqual([DRAFT]);
  });

  it('approve posts with no body and shows the created task', async () => {
    const r = await auto(['draft', 'approve', '5'], ok({ ...DRAFT, status: 'approved', approvedTaskId: 99 }));
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post.mock.calls[0]).toEqual([`${BASE}/task-drafts/5/approve`, undefined]);
    expect(r.stdout).toContain('已批准');
    expect(r.stdout).toContain('任务 #99');
  });

  it('reject posts with no body', async () => {
    const r = await auto(['draft', 'reject', '5'], ok({ ...DRAFT, status: 'rejected' }));
    expect(r.http.post.mock.calls[0]).toEqual([`${BASE}/task-drafts/5/reject`, undefined]);
    expect(r.stdout).toContain('已驳回');
  });

  it('an AI key answer 2703 is explained, not pre-judged locally', async () => {
    const r = await auto(['draft', 'approve', '5'], bizError(2703, 'AUTOMATION_AI_FORBIDDEN') as Envelope);
    expect(r.http.post).toHaveBeenCalledTimes(1);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('人类 Key');
  });

  it('1002 / 2000 / 2702 each get a draft-specific message (2702 exits 3 like other conflicts)', async () => {
    expect((await auto(['draft', 'reject', '5'], bizError(1002, 'x') as Envelope)).stderr).toContain('草案不存在');
    expect((await auto(['draft', 'approve', '5'], bizError(2000, 'x') as Envelope)).stderr).toContain('启用人或组织 owner/admin');
    const r = await auto(['draft', 'approve', '5'], bizError(2702, 'x') as Envelope);
    expect(r.stderr).toContain('草案当前状态');
    expect(r.exitCode).toBe(3);
  });

  it('rejects a bad draft id without calling the API', async () => {
    const r = await auto(['draft', 'approve', 'abc']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('uses --org-id over the environment', async () => {
    const r = await auto(['draft', 'list', '--org-id', '9'], ok([]));
    expect(r.http.get.mock.calls[0][0]).toBe('/api/v1/orgs/9/automations/task-drafts');
  });
});
