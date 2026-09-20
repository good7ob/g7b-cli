import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../../services/ApiClient';
import { registerWorkspaceCommands } from '../index';
import { buildWorkLogParams, parseReportDate } from '../aiTeamInput';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const ws = (args: string[], response = ok(null)) => runCli(registerWorkspaceCommands, ['workspace', ...args], response);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-19T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function expectRejected(args: string[], needle: string) {
  const r = await ws(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const employee = (over: Record<string, unknown> = {}) => ({
  id: 7, orgId: 58, orgName: 'RemoStudio', name: 'Cursor Agent', agentKind: 'CURSOR', state: 'error', stateReason: 'blocked_tasks',
  currentTasks: [{ id: 182, name: '支付 API 开发', status: 'blocked', blockedReason: 'REWORK_LIMIT_REACHED' }, { id: 5, name: 'x', status: 'in_progress', blockedReason: null }],
  queueLength: 2,
  stats: { tasksCompleted: 12, successRate: 0.8, workingHours: 31.5, tokens: 120345, cost: null, score: 0.82, reworkRejected: 2, blockedEvents: 1 },
  ...over,
});
const idle = employee({ id: 8, name: 'Idle Bot', state: 'idle', stateReason: null, currentTasks: [], queueLength: 0,
  stats: { tasksCompleted: 0, successRate: null, workingHours: null, tokens: 0, cost: null, score: null, reworkRejected: 0, blockedEvents: 0 } });
const team = { total: 2, counts: { working: 0, waiting: 0, error: 1, idle: 1 }, employees: [employee(), idle] };

describe('workspace ai-team', () => {
  it('GETs /workspace/my-ai-team with no params by default', async () => {
    const r = await ws(['ai-team'], ok(team));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-ai-team', { params: {} });
    expect(r.exitCode).toBeUndefined();
  });

  it('passes --status (any case, canonical lower) and --org', async () => {
    const r = await ws(['ai-team', '--status', 'ERROR', '--org', '58'], ok(team));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-ai-team', { params: { status: 'error', orgId: 58 } });
    expect(r.stdout).toContain('（筛选: error）');
  });

  it.each(['working', 'waiting', 'error', 'idle', 'all'])('accepts --status %s', async (status) => {
    expect((await ws(['ai-team', '--status', status], ok(team))).exitCode).toBeUndefined();
  });

  it.each([
    [['--status', 'busy'], '--status'],
    [['--status', ''], '--status'],
    [['--org', '0'], '--org'],
    [['--org', 'x'], '--org'],
  ])('rejects %j before calling the API', (flags, needle) => expectRejected(['ai-team', ...flags], needle));

  it('rejects a stray operand instead of silently listing', async () => {
    const r = await ws(['ai-team', 'nope']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('renders counts, state + reason, current task, queue and stats (0 stays 0, null becomes —)', async () => {
    const out = (await ws(['ai-team'], ok(team))).stdout;
    expect(out).toContain('我的 AI 团队: 2');
    expect(out).toContain('工作中 0  等待中 0  异常 1  空闲 1');
    expect(out).toMatch(/7\s+Cursor Agent\s+RemoStudio\s+异常（有阻塞任务）\s+#182 支付 API 开发 \[blocked\/REWORK_LIM/);
    expect(out).toMatch(/7\s+Cursor Agent.*\s2\s+12\s+80%\s+31\.5\s+120345\s+0\.82\s+2\s+1/);
    expect(out).toMatch(/8\s+Idle Bot\s+RemoStudio\s+空闲\s+—\s+0\s+0\s+—\s+—\s+0\s+—\s+0\s+0/);
    expect(out).not.toContain('成本  ');
  });

  it('explains the score and the missing cost instead of inventing them', async () => {
    const out = (await ws(['ai-team'], ok(team))).stdout;
    expect(out).toContain('不是员工质量评分');
    expect(out).toContain('成本暂无来源');
  });

  it('shows the last-record-failed reason and a waiting state', async () => {
    const out = (await ws(['ai-team'], ok({ total: 2, counts: { working: 0, waiting: 1, error: 1, idle: 0 }, employees: [
      employee({ stateReason: 'last_record_failed', currentTasks: [] }), employee({ id: 9, state: 'waiting', stateReason: null, currentTasks: [{ id: 3, name: '等审批', status: 'awaiting_plan_approval' }] }),
    ] }))).stdout;
    expect(out).toContain('异常（最近工作记录失败）');
    expect(out).toContain('等待中');
  });

  it('empty team / null body / missing counts do not crash', async () => {
    expect((await ws(['ai-team'], ok({ total: 0, counts: { working: 0, waiting: 0, error: 0, idle: 0 }, employees: [] }))).stdout).toContain('没有 AI 员工');
    const nul = await ws(['ai-team'], ok(null));
    expect(nul.exitCode).toBeUndefined();
    expect(nul.stdout).toContain('工作中 —');
  });

  it('prints --json before or after the subcommand position', async () => {
    expect(JSON.parse((await ws(['ai-team', '--json'], ok(team))).stdout).total).toBe(2);
  });

  it.each([[1001, '参数值不合法'], [2000, '不是你所在的组织'], [400, '缺少用户身份']])('maps business error %i', async (code, text) => {
    const r = await ws(['ai-team'], bizError(code, 'srv'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
  });
});

const log = {
  employeeId: 7, from: '2026-09-12T00:00:00', to: '2026-09-19T23:59:59', pageNum: 1, pageSize: 20, total: 37,
  items: [
    { time: '2026-09-19T10:32:00', type: 'STATE_CHANGE', taskId: 182, title: '支付 API 开发', detail: 'in_progress -> awaiting_completion_approval (done)' },
    { time: '2026-09-19T09:00:00', type: 'WORK_RECORD', taskId: null, title: null, detail: null },
    { time: '2026-09-18T09:00:00', type: 'REVIEW', taskId: 3, title: 't', detail: 'reject: 缺少测试' },
  ],
};

describe('workspace ai-team log <employeeId>', () => {
  it('GETs with default paging and no range (server picks the last 7 days)', async () => {
    const r = await ws(['ai-team', 'log', '7'], ok(log));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-ai-team/7/work-log', { params: { pageNum: 1, pageSize: 20 } });
  });

  it('passes --from / --to (date or date-time) and paging', async () => {
    const r = await ws(['ai-team', 'log', '7', '--from', '2026-09-01', '--to', '2026-09-19T12:30', '-p', '2', '--page-size', '100'], ok(log));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-ai-team/7/work-log', { params: { from: '2026-09-01', to: '2026-09-19T12:30', pageNum: 2, pageSize: 100 } });
  });

  it('renders the timeline with type labels, task, null cells as — and the page footer', async () => {
    const out = (await ws(['ai-team', 'log', '7'], ok(log))).stdout;
    expect(out).toContain('AI 员工 #7 工作日志    2026-09-12 00:00:00 → 2026-09-19 23:59:59    共 37 条，第 1/2 页');
    expect(out).toMatch(/2026-09-19 10:32:00\s+状态变更\s+#182 支付 API 开发\s+in_progress -> awaiting_completion_approval \(done\)/);
    expect(out).toMatch(/2026-09-19 09:00:00\s+工作记录\s+—\s+—/);
    expect(out).toMatch(/评审\s+#3 t\s+reject: 缺少测试/);
  });

  it('empty range / null body / --json', async () => {
    expect((await ws(['ai-team', 'log', '7'], ok({ ...log, total: 0, items: [] }))).stdout).toContain('该时间范围内没有记录');
    expect((await ws(['ai-team', 'log', '7'], ok(null))).exitCode).toBeUndefined();
    expect(JSON.parse((await ws(['ai-team', 'log', '7', '--json'], ok(log))).stdout).total).toBe(37);
  });

  it.each([
    [['x'], 'employeeId'],
    [['0'], 'employeeId'],
    [['7', '--from', '2026-9-1'], '--from'],
    [['7', '--from', '2026-02-30'], '--from'],
    [['7', '--to', '2026-09-19T24:00'], '--to'],
    [['7', '--to', '2026-09-19T10:60'], '--to'],
    [['7', '--to', '2026-09-19 10:00'], '--to'],
    [['7', '--from', '2026-09-19', '--to', '2026-09-01'], '不能晚于'],
    [['7', '--from', '2026-08-01', '--to', '2026-09-19'], '31 天'],
    [['7', '--page', '0'], '--page'],
    [['7', '--page-size', '0'], '--page-size'],
    [['7', '--page-size', '101'], '--page-size'],
  ])('rejects %j locally', (args, needle) => expectRejected(['ai-team', 'log', ...args], needle));

  it('range arithmetic mirrors the backend: 31 days apart as dates is too wide (end of day), 30 is fine', () => {
    expect(() => buildWorkLogParams({ from: '2026-08-01', to: '2026-09-01' })).toThrow('31 天');
    expect(buildWorkLogParams({ from: '2026-08-01', to: '2026-08-31' })).toMatchObject({ to: '2026-08-31' });
    // date-times: exactly 31 days is allowed, one second more is not
    expect(buildWorkLogParams({ from: '2026-08-01T00:00:00', to: '2026-09-01T00:00:00' })).toBeTruthy();
    expect(() => buildWorkLogParams({ from: '2026-08-01T00:00:00', to: '2026-09-01T00:00:01' })).toThrow('31 天');
    // one end only: the backend derives the other, the CLI cannot check
    expect(buildWorkLogParams({ from: '2020-01-01' })).toMatchObject({ from: '2020-01-01' });
  });

  it.each([[1001, '参数值不合法'], [1002, 'AI 员工不存在'], [2000, '不是你所在的组织']])('maps business error %i', async (code, text) => {
    const r = await ws(['ai-team', 'log', '7'], bizError(code, 'srv'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
  });
});

const daily = {
  date: '2026-09-19', source: 'template', generatedAt: '2026-09-19T21:00:00', content: '# 2026-09-19 工作日报\n\n完成 5 项',
  sections: { summary: { completed: 5 }, degraded: [] }, aiWarning: null,
};

describe('workspace daily-report', () => {
  it('GETs the stored report (default today = no params) and prints header + Markdown', async () => {
    const r = await ws(['daily-report'], ok(daily));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/daily-report', { params: {} });
    expect(r.stdout).toContain('日报 2026-09-19    来源 template（确定性）    生成于 2026-09-19 21:00:00');
    expect(r.stdout).toContain('# 2026-09-19 工作日报');
    expect(r.stdout).not.toContain('AI 生成');
  });

  it('--date is validated (real day, not in the future) and sent', async () => {
    expect((await ws(['daily-report', '--date', '2026-09-18'], ok(daily))).http.get).toHaveBeenCalledWith('/workspace/daily-report', { params: { date: '2026-09-18' } });
    await expectRejected(['daily-report', '--date', '2026-02-30'], '--date');
    await expectRejected(['daily-report', '--date', '09/18/2026'], '--date');
    await expectRejected(['daily-report', '--date', '2026-09-22'], '不能晚于今天');
    expect(parseReportDate('2026-09-20', new Date('2026-09-19T23:00:00Z'))).toBe('2026-09-20');
  });

  it('1002 = none stored yet, with the command that creates it', async () => {
    const r = await ws(['daily-report'], bizError(1002, '日报不存在'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('还没有 AI 日报');
    expect(r.stderr).toContain('daily-report generate');
  });

  it('marks an AI report as AI-generated and lists degraded sections', async () => {
    const out = (await ws(['daily-report'], ok({ ...daily, source: 'ai', sections: { degraded: ['queue'] } }))).stdout;
    expect(out).toContain('来源 ai');
    expect(out).toContain('含 AI 叙述总结（AI 生成，需人工确认');
    expect(out).toContain('部分分节加载失败（该节为空）: queue');
  });

  it('null body / empty content / --json', async () => {
    expect((await ws(['daily-report'], ok(null))).exitCode).toBeUndefined();
    expect((await ws(['daily-report'], ok({ ...daily, content: null }))).stdout).toContain('（日报没有正文）');
    expect(JSON.parse((await ws(['daily-report', '--json'], ok(daily))).stdout).sections.summary.completed).toBe(5);
  });

  it('generate: POSTs {} by default (deterministic, default client timeout)', async () => {
    const r = await ws(['daily-report', 'generate'], ok(daily));
    expect(r.http.post).toHaveBeenCalledWith('/workspace/daily-report', {});
    expect(r.stdout).toContain('✓ 日报已生成');
  });

  it('generate --date --ai: body + long client timeout; --date after `generate` works too', async () => {
    const r = await ws(['daily-report', 'generate', '--date', '2026-09-18', '--ai'], ok({ ...daily, source: 'ai' }));
    expect(r.http.post).toHaveBeenCalledWith('/workspace/daily-report', { date: '2026-09-18', useAi: true }, { timeout: 180000 });
    expect(r.stdout).toContain('AI 生成，需人工确认');
    const before = await ws(['daily-report', '--date', '2026-09-18', 'generate'], ok(daily));
    expect(before.http.post).toHaveBeenCalledWith('/workspace/daily-report', { date: '2026-09-18' });
  });

  it('generate: an AI failure degrades to the deterministic report with the reason', async () => {
    const r = await ws(['daily-report', 'generate', '--ai'], ok({ ...daily, aiWarning: '配额不足' }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('⚠ 未能使用 AI：配额不足（已降级为确定性日报）');
    expect(r.stdout).toContain('来源 template');
  });

  it('generate: rejects a bad / future date; maps 1001; timeout hint', async () => {
    await expectRejected(['daily-report', 'generate', '--date', '2026-09-30'], '不能晚于今天');
    expect((await ws(['daily-report', 'generate'], bizError(1001, 'date 晚于今天'))).stderr).toContain('日报日期错或晚于今天');
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('timeout of 180000ms exceeded'));
    const r = await ws(['daily-report', 'generate', '--ai']);
    expect(r.stderr).toContain('不要盲目重试');
  });
});

const actions = {
  total: 12,
  items: [
    { kind: 'QUEUE_ITEM', itemId: 501, taskId: 182, sourceType: 'TASK', sourceId: 182, actionType: 'COMPLETION_APPROVAL', title: '支付 API 开发', priority: 'high', dueAt: '2026-09-17T18:00:00', productId: 12, orgId: 3, score: 112,
      reasons: ['优先级 high（+30）', '已逾期 2 天（+44）'], factors: [{ code: 'PRIORITY_HIGH', points: 30 }, { code: 'OVERDUE', points: 44 }] },
    { kind: 'TASK', itemId: null, taskId: 9, sourceType: 'TASK', sourceId: 9, actionType: null, title: '写文档', priority: null, dueAt: null, productId: null, orgId: null, score: 5, reasons: [], factors: [] },
  ],
};

describe('workspace next-actions', () => {
  it('GETs with limit 5 by default and --limit', async () => {
    expect((await ws(['next-actions'], ok(actions))).http.get).toHaveBeenCalledWith('/workspace/next-actions', { params: { limit: 5 } });
    expect((await ws(['next-actions', '-l', '20'], ok(actions))).http.get).toHaveBeenCalledWith('/workspace/next-actions', { params: { limit: 20 } });
    expect((await ws(['next-actions', '--limit', '1'], ok(actions))).exitCode).toBeUndefined();
  });

  it.each(['0', '21', '-1', 'x', '2.5'])('rejects --limit %s before calling the API', (bad) => expectRejected(['next-actions', '--limit', bad], '--limit'));

  it('renders score, title, ids, action, priority, due and every reason; nulls are —', async () => {
    const out = (await ws(['next-actions'], ok(actions))).stdout;
    expect(out).toContain('候选 12 个，显示前 2 个');
    expect(out).toContain('1. 得分 112  支付 API 开发    [队列项]');
    expect(out).toContain('队列项 #501 · 任务 #182 · 完成审批 · 优先级 high · 到期 2026-09-17 18:00:00');
    expect(out).toContain('· 已逾期 2 天（+44）');
    expect(out).toContain('2. 得分 5  写文档    [任务]');
    expect(out).toContain('任务 #9 · 优先级 — · 到期 —');
  });

  it('a real score of 0 is 0; nothing to do says so; null body / --json', async () => {
    expect((await ws(['next-actions'], ok({ total: 1, items: [{ ...actions.items[1], score: 0 }] }))).stdout).toContain('得分 0');
    expect((await ws(['next-actions'], ok({ total: 0, items: [] }))).stdout).toContain('现在没有需要你处理的事项');
    expect((await ws(['next-actions'], ok(null))).exitCode).toBeUndefined();
    expect(JSON.parse((await ws(['next-actions', '--json'], ok(actions))).stdout).items[0].factors[0].code).toBe('PRIORITY_HIGH');
  });

  it('maps 400 (no user) and 1001', async () => {
    expect((await ws(['next-actions'], bizError(400, 'userId header is required'))).stderr).toContain('缺少用户身份');
    expect((await ws(['next-actions'], bizError(1001))).exitCode).toBe(1);
  });
});
