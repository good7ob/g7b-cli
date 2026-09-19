import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../../services/ApiClient';
import { registerWorkspaceCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const ws = (args: string[], response = ok(null)) => runCli(registerWorkspaceCommands, ['workspace', ...args], response);
const q = (args: string[], response = ok(null)) => ws(['queue', ...args], response);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-19T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const item = (over: Record<string, unknown> = {}) => ({
  id: 501, status: 'new', sourceType: 'APPROVAL', sourceId: 31, actionType: 'APPROVAL', title: '发布 v1.2.0',
  description: '请审批', priority: 'medium', projectId: null, projectName: null, productId: 12, orgId: 3,
  dueAt: null, snoozedUntil: null, createdAt: '2026-09-19T09:00:00', ...over,
});

describe('workspace queue: filters and rendering', () => {
  it('sends --status / --action-type / --product with the limit, in canonical case', async () => {
    const r = await q(['--status', 'IN_PROGRESS', '--action-type', 'risk_alert', '--product', '12', '-l', '7'],
      ok({ total: 0, counts: {}, items: [] }));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-queue',
      { params: { limit: 7, status: 'in_progress', actionType: 'RISK_ALERT', productId: 12 } });
    expect(r.exitCode).toBeUndefined();
  });

  it.each([
    [['--status', 'pending'], '--status'],
    [['--action-type', 'TASK'], '--action-type'],
    [['--product', '0'], '--product'],
    [['--product', 'x'], '--product'],
  ])('rejects %j before calling the API', async (args, label) => {
    const r = await q(args);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(label);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('rejects a stray operand instead of silently listing', async () => {
    const r = await q(['countz']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('shows queue-item id, status, due date, snooze time, and the new action types', async () => {
    const r = await q(['--status', 'all'], ok({
      total: 3,
      counts: { APPROVAL: 1, RISK_ALERT: 1, BLOCKED: 1 },
      items: [
        item(),
        item({ id: 502, sourceType: 'TASK', sourceId: 9, actionType: 'BLOCKED', title: '阻塞任务', projectId: 4, projectName: '主项目', dueAt: '2026-09-20T18:00:00' }),
        item({ id: 503, status: 'snoozed', sourceType: 'RISK', sourceId: 12, actionType: 'RISK_ALERT', title: '产品风险', snoozedUntil: '2026-09-20T09:00:00' }),
      ],
    }));
    expect(r.stdout).toContain('全部: 3');
    expect(r.stdout).toContain('审批申请 1');
    expect(r.stdout).toContain('风险预警 1');
    expect(r.stdout).toMatch(/501\s+new\s+APPROVAL\s+31\s+审批申请\s+medium\s+—\s+发布 v1\.2\.0/);
    expect(r.stdout).toMatch(/502\s+new\s+TASK\s+9\s+已阻塞\s+medium\s+主项目\s+阻塞任务\s+2026-09-20 18:00:00/);
    expect(r.stdout).toMatch(/503\s+snoozed\s+RISK\s+12\s+风险预警.*稍后至 2026-09-20 09:00:00 UTC/);
  });

  it('headline follows the status filter', async () => {
    const r = await q(['--status', 'done'], ok({ total: 2, counts: {}, items: [] }));
    expect(r.stdout).toContain('已完成: 2');
    expect(r.stdout).not.toContain('待我处理');
  });

  it('--json prints the raw payload, including the new fields', async () => {
    const r = await q(['--json'], ok({ total: 1, counts: {}, items: [item()] }));
    expect(JSON.parse(r.stdout).items[0]).toMatchObject({ id: 501, status: 'new', productId: 12, orgId: 3 });
  });

  it('maps 1001 (unknown filter the backend rejects) with the server message', async () => {
    const r = await q([], bizError(1001, '未知的 status: x'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('参数值不合法');
    expect(r.stderr).toContain('未知的 status: x');
  });
});

describe('workspace queue counts', () => {
  const counts = { total: 4, counts: { APPROVAL: 1, BLOCKED: 2, RISK_ALERT: 0 }, snoozed: 0, dismissed: 1, done: 9 };

  it('GETs /workspace/my-queue/counts and renders active + parked buckets', async () => {
    const r = await q(['counts'], ok(counts));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-queue/counts', { params: undefined });
    expect(r.stdout).toContain('待我处理: 4');
    expect(r.stdout).toContain('审批申请 1');
    expect(r.stdout).toContain('风险预警 0');
    expect(r.stdout).toContain('计划审批 —'); // not sent -> —, never 0
    expect(r.stdout).toContain('已稍后 0  已忽略 1  已完成 9');
  });

  it('honours --json placed after the subcommand (the parent must not swallow it)', async () => {
    const r = await q(['counts', '--json'], ok(counts));
    expect(JSON.parse(r.stdout).done).toBe(9);
  });

  it('null buckets render as —', async () => {
    const r = await q(['counts'], ok({ total: null, counts: null, snoozed: null, dismissed: null, done: null }));
    expect(r.stdout).toContain('待我处理: —');
    expect(r.stdout).toContain('已稍后 —  已忽略 —  已完成 —');
  });

  it('maps a missing user', async () => {
    const r = await q(['counts'], bizError(400, 'userId header is required'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('userId');
  });
});

describe.each([
  ['dismiss', '已忽略', 'dismissed'],
  ['done', '已标记处理', 'done'],
  ['reopen', '已重新打开', 'new'],
])('workspace queue %s', (verb, label, status) => {
  it('POSTs /workspace/my-queue/{id}/%s and confirms', async () => {
    const r = await q([verb, '501'], ok(item({ status })));
    expect(r.http.post).toHaveBeenCalledWith(`/workspace/my-queue/501/${verb}`, undefined);
    expect(r.stdout).toBe(`✓ 队列项 #501 ${label} (${status}) — 发布 v1.2.0`);
  });

  it('--json prints the item', async () => {
    const r = await q([verb, '501', '--json'], ok(item({ status })));
    expect(JSON.parse(r.stdout)).toMatchObject({ id: 501, status });
  });

  it.each(['0', '-1', 'abc', '1.5', '9007199254740993', ''])('rejects id %j before calling the API', async (bad) => {
    const r = await q([verb, bad]);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('id is required', async () => {
    const r = await q([verb]);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });

  it.each([[1002, '不存在'], [1007, '当前状态不支持'], [999, '未登录']])('maps code %i', async (code, text) => {
    const r = await q([verb, '501'], bizError(code, 'srv'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain('srv');
  });
});

describe('workspace queue snooze', () => {
  it('sends the ISO instant as UTC', async () => {
    const r = await q(['snooze', '501', '--until', '2026-09-20T17:00:00+08:00'],
      ok(item({ status: 'snoozed', snoozedUntil: '2026-09-20T09:00:00' })));
    expect(r.http.post).toHaveBeenCalledWith('/workspace/my-queue/501/snooze', { until: '2026-09-20T09:00:00Z' });
    expect(r.stdout).toBe('✓ 队列项 #501 已稍后处理 (snoozed)，至 2026-09-20 09:00:00 UTC — 发布 v1.2.0');
  });

  it.each([['+2h', '2026-09-19T12:00:00Z'], ['+1d', '2026-09-20T10:00:00Z'], ['+30d', '2026-10-19T10:00:00Z']])(
    'resolves relative %s against now', async (rel, iso) => {
      const r = await q(['snooze', '501', '--until', rel], ok(item({ status: 'snoozed', snoozedUntil: null })));
      expect(r.http.post).toHaveBeenCalledWith('/workspace/my-queue/501/snooze', { until: iso });
      expect(r.exitCode).toBeUndefined();
    });

  it.each([
    ['2026-09-19T09:00:00Z', '必须晚于当前时间'],
    ['+31d', '最多只能稍后 30 天'],
    ['2026-02-30T10:00:00Z', '不是有效的时间'],
    ['soon', '不是有效的时间'],
    ['2026-09-20', '不是有效的时间'],
  ])('rejects --until %s before calling the API', async (until, message) => {
    const r = await q(['snooze', '501', '--until', until]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('参数错误');
    expect(r.stderr).toContain(message);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('--until is required', async () => {
    const r = await q(['snooze', '501']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--until');
    expect(noHttpCalls(r)).toBe(true);
  });

  it('validates the id too', async () => {
    const r = await q(['snooze', 'x', '--until', '+1h']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('maps a backend rejection (1001 clock skew, 1007 done item)', async () => {
    const a = await q(['snooze', '501', '--until', '+1h'], bizError(1001, 'until 必须晚于当前时间'));
    expect(a.stderr).toContain('参数值不合法');
    const b = await q(['snooze', '501', '--until', '+1h'], bizError(1007, '当前状态（done）不支持该操作'));
    expect(b.stderr).toContain('当前状态不支持');
    expect(b.stderr).toContain('done');
  });
});

describe('workspace queue approve / reject', () => {
  const decided = (over: Record<string, unknown> = {}, outcome = 'approved') =>
    ok({ item: item({ status: 'done', ...over }), action: outcome === 'approved' ? 'approve' : 'reject', outcome });

  it('approve without a comment sends only the action', async () => {
    const r = await q(['approve', '501'], decided());
    expect(r.http.post).toHaveBeenCalledWith('/workspace/my-queue/501/action', { action: 'approve' });
    expect(r.stdout).toBe('✓ 队列项 #501 已批准 (approved) — 发布 v1.2.0');
  });

  it('approve with --comment', async () => {
    const r = await q(['approve', '501', '--comment', 'lgtm'], decided());
    expect(r.http.post).toHaveBeenCalledWith('/workspace/my-queue/501/action', { action: 'approve', comment: 'lgtm' });
  });

  it('approving a plan says the Agent was resumed', async () => {
    const r = await q(['approve', '7'], decided({ id: 7, actionType: 'PLAN_APPROVAL', title: '审批计划' }));
    expect(r.stdout).toBe('✓ 队列项 #7 已批准 (approved)，已恢复 Agent 执行 — 审批计划');
  });

  it('reject sends the comment', async () => {
    const r = await q(['reject', '501', '--comment', 'scope too big'], decided({}, 'rejected'));
    expect(r.http.post).toHaveBeenCalledWith('/workspace/my-queue/501/action', { action: 'reject', comment: 'scope too big' });
    expect(r.stdout).toBe('✓ 队列项 #501 已驳回 (rejected) — 发布 v1.2.0');
  });

  it('reject needs --comment (missing or blank) and never calls the API', async () => {
    const missing = await q(['reject', '501']);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('--comment');
    expect(noHttpCalls(missing)).toBe(true);
    const blank = await q(['reject', '501', '--comment', '  ']);
    expect(blank.exitCode).toBe(1);
    expect(blank.stderr).toContain('--comment');
    expect(noHttpCalls(blank)).toBe(true);
  });

  it('--json prints {item, action, outcome}', async () => {
    const r = await q(['approve', '501', '--json'], decided());
    expect(JSON.parse(r.stdout)).toMatchObject({ action: 'approve', outcome: 'approved', item: { id: 501, status: 'done' } });
  });

  it.each(['approve', 'reject'])('%s validates the id', async (verb) => {
    const r = await q([verb, 'abc', '--comment', 'x']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });

  it.each([
    [1000, '缺少必填参数'],
    [1001, '参数值不合法'],
    [1002, '不属于你'],
    [1007, '不能就地决定'],
    [1009, '已被他人处理'],
    [2000, '无权限'],
    [999, '未登录'],
  ])('maps business code %i', async (code, text) => {
    const r = await q(['approve', '501'], bizError(code, 'srv-msg'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain(`${code}`);
    expect(r.stderr).toContain('srv-msg');
  });

  it('adds a "do not blindly retry" hint on a client timeout (the plan approval runs the Agent synchronously)', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('timeout of 30000ms exceeded'));
    const r = await q(['approve', '501']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('timeout of 30000ms exceeded');
    expect(r.stderr).toContain('不要盲目重试');
  });
});
