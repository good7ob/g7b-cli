import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWorkspaceCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const ws = (args: string[], response = ok(null)) => runCli(registerWorkspaceCommands, ['workspace', ...args], response);

afterEach(() => vi.restoreAllMocks());

const card = (over: Record<string, unknown> = {}) => ({
  productId: 12, name: 'good7ob', orgId: 3, orgName: 'RemoStudio', status: 'active', archived: false,
  owned: true, participating: true, following: false, myOpenTasks: 8, blockedCount: 2, aiWorkingCount: 3,
  progress: 67, riskLevel: 'LOW', ...over,
});

const task = (over: Record<string, unknown> = {}) => ({
  id: 8, name: '实现导出', status: 'paused', priority: 'high', deadline: '2026-09-20T18:00:00',
  projectId: 5, projectName: '主项目', productId: 12, progress: 30, executorType: 'AGENT', ...over,
});

describe('workspace overview', () => {
  const overview = {
    queue: { total: 4, counts: { APPROVAL: 1, BLOCKED: 2, RISK_ALERT: 0 }, snoozed: 0, dismissed: 1, done: 9 },
    tasks: { today: 5, todo: 3, inProgress: 4, waiting: 1, blocked: 2, done: 30 },
    products: [card(), card({ productId: 13, name: '另一个', progress: null, riskLevel: null })],
    recentActivity: [
      { type: 'AI_WORK', at: '2026-09-19T10:32:00', taskId: 8, taskName: '实现导出', text: '完成导出接口', actor: 'hermes-v1' },
      { type: 'STATE_CHANGE', at: [2026, 9, 19, 9, 5, 7, 0], taskId: 9, taskName: null, text: 'pending -> in_progress', actor: 'USER' },
    ],
    aiTeam: null,
    degraded: [],
  };

  it('GETs /workspace/overview and renders the four blocks', async () => {
    const r = await ws(['overview'], ok(overview));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/overview', { params: undefined });
    expect(r.stdout).toContain('── 待办队列 ──');
    expect(r.stdout).toContain('待我处理: 4');
    expect(r.stdout).toContain('已稍后 0  已忽略 1  已完成 9');
    expect(r.stdout).toContain('今日 5  待开始 3  进行中 4  等待中 1  已阻塞 2  已完成 30');
    expect(r.stdout).toMatch(/12\s+good7ob\s+RemoStudio\s+active\s+创建\/参与\s+8\s+2\s+3\s+67%\s+LOW/);
    expect(r.stdout).toMatch(/13\s+另一个\s+RemoStudio\s+active\s+创建\/参与\s+8\s+2\s+3\s+—\s+—/);
    expect(r.stdout).toContain('进度 / 风险只评估前 20 张卡片');
    expect(r.stdout).toMatch(/2026-09-19 10:32:00\s+AI 工作\s+#8 实现导出\s+hermes-v1\s+完成导出接口/);
    expect(r.stdout).toContain('2026-09-19 09:05:07'); // array-form timestamp
    expect(r.stdout).toMatch(/状态变更\s+#9 —/);
    expect(r.stdout).not.toContain('加载失败');
  });

  it('marks a failed block and lists it as degraded; the other blocks still render', async () => {
    const r = await ws(['overview'], ok({ ...overview, tasks: null, recentActivity: null, degraded: ['tasks', 'recentActivity'] }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toMatch(/── 我的任务 ──\n（加载失败）/);
    expect(r.stdout).toMatch(/── 最近动态 ──\n（加载失败）/);
    expect(r.stdout).toContain('⚠ 部分内容加载失败: tasks, recentActivity');
    expect(r.stdout).toContain('待我处理: 4');
  });

  it('empty products / activity, and a fully empty payload, do not crash', async () => {
    const empty = await ws(['overview'], ok({ ...overview, products: [], recentActivity: [] }));
    expect(empty.stdout).toContain('没有产品。');
    expect(empty.stdout).toContain('暂无动态。');
    const blank = await ws(['overview'], ok(null));
    expect(blank.exitCode).toBeUndefined();
    expect(blank.stdout).toContain('（加载失败）');
  });

  it('--json prints the raw payload', async () => {
    const r = await ws(['overview', '--json'], ok(overview));
    expect(JSON.parse(r.stdout).tasks.inProgress).toBe(4);
  });

  it('maps a missing user', async () => {
    const r = await ws(['overview'], bizError(400, 'userId header is required'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('userId');
  });
});

describe('workspace tasks', () => {
  const grouped = {
    group: 'waiting', pageNum: 1, pageSize: 20, total: 45,
    counts: { today: 5, todo: 3, inProgress: 4, waiting: 45, blocked: 2, done: 30 },
    items: [task(), task({ id: 9, name: '无截止', deadline: null, projectName: null, projectId: null, progress: null, executorType: null, priority: null })],
  };

  it('--group sends group + default paging and renders the page', async () => {
    const r = await ws(['tasks', '--group', 'waiting'], ok(grouped));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-tasks', { params: { group: 'waiting', pageNum: 1, pageSize: 20 } });
    expect(r.stdout).toContain('分组: waiting  共 45 条，第 1/3 页');
    expect(r.stdout).toContain('今日 5  待开始 3  进行中 4  等待中 45');
    expect(r.stdout).toMatch(/8\s+实现导出\s+paused\s+high\s+2026-09-20 18:00:00\s+主项目\s+30%\s+AGENT/);
    expect(r.stdout).toMatch(/9\s+无截止\s+paused\s+—\s+—\s+—\s+—\s+—/);
    expect(r.stdout).toContain('下一页: --page 2');
  });

  it('passes -p and --page-size, no next-page hint on the last page', async () => {
    const r = await ws(['tasks', '--group', 'Done', '-p', '3', '--page-size', '20'], ok({ ...grouped, group: 'done', pageNum: 3 }));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-tasks', { params: { group: 'done', pageNum: 3, pageSize: 20 } });
    expect(r.stdout).toContain('第 3/3 页');
    expect(r.stdout).not.toContain('下一页');
  });

  it('empty group', async () => {
    const r = await ws(['tasks', '--group', 'blocked'], ok({ group: 'blocked', pageNum: 1, pageSize: 20, total: 0, counts: {}, items: [] }));
    expect(r.stdout).toContain('该分组没有任务。');
    expect(r.stdout).toContain('今日 —'); // counts not sent -> —
  });

  it('array-form deadline renders', async () => {
    const r = await ws(['tasks', '--group', 'today'], ok({ ...grouped, items: [task({ deadline: [2026, 9, 20, 18, 0, 0, 0] })] }));
    expect(r.stdout).toContain('2026-09-20 18:00:00');
  });

  it('without --group it asks for the MVP summary (no params) and renders summary + urgent tasks', async () => {
    const r = await ws(['tasks'], ok({ total: 12, summary: { today: 2, inProgress: 3, awaiting: 1, overdue: 0 }, items: [task()] }));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-tasks', { params: {} });
    expect(r.stdout).toContain('我的开放任务: 12');
    expect(r.stdout).toContain('今日 2  进行中 3  待审批 1  已逾期 0');
    expect(r.stdout).toContain('显示最紧急的 1 / 12 条');
  });

  it('without --group, --limit is passed through', async () => {
    const r = await ws(['tasks', '--limit', '50'], ok({ total: 0, summary: {}, items: [] }));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-tasks', { params: { limit: 50 } });
    expect(r.stdout).toContain('没有开放任务。');
  });

  it.each([
    [['--group', 'later'], '--group'],
    [['--group', 'todo', '--page', '0'], '--page'],
    [['--group', 'todo', '--page', 'x'], '--page'],
    [['--group', 'todo', '--page-size', '101'], '--page-size'],
    [['--group', 'todo', '--page-size', '0'], '--page-size'],
    [['--page', '2'], '--group'],
    [['--page-size', '10'], '--group'],
    [['--limit', '51'], '--limit'],
    [['--limit', '0'], '--limit'],
    [['--group', 'todo', '--limit', '5'], '--limit'],
  ])('rejects %j before calling the API', async (args, label) => {
    const r = await ws(['tasks', ...args]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(label);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('--json prints the raw payload in both modes', async () => {
    const a = await ws(['tasks', '--group', 'waiting', '--json'], ok(grouped));
    expect(JSON.parse(a.stdout).total).toBe(45);
    const b = await ws(['tasks', '--json'], ok({ total: 1, summary: {}, items: [] }));
    expect(JSON.parse(b.stdout).total).toBe(1);
  });

  it('maps 1001 from the backend', async () => {
    const r = await ws(['tasks', '--group', 'todo'], bizError(1001, '未知的 group'));
    expect(r.stderr).toContain('参数值不合法');
    expect(r.stderr).toContain('未知的 group');
  });
});

describe('workspace products', () => {
  it('defaults to the backend default scope (no param) and renders cards', async () => {
    const r = await ws(['products'], ok({ scope: 'all', total: 2, items: [card(), card({ productId: 14, name: '关注中', owned: false, participating: false, following: true, progress: null, riskLevel: null })] }));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-products', { params: {} });
    expect(r.stdout).toContain('范围: all  共 2 个产品');
    expect(r.stdout).toMatch(/12\s+good7ob\s+RemoStudio\s+active\s+创建\/参与\s+8\s+2\s+3\s+67%\s+LOW/);
    expect(r.stdout).toMatch(/14\s+关注中\s+RemoStudio\s+active\s+关注\s+8\s+2\s+3\s+—\s+—/);
    expect(r.stdout).toContain('进度 / 风险只评估前 20 张卡片');
  });

  it('--scope is validated and lower-cased', async () => {
    const r = await ws(['products', '--scope', 'Archived'], ok({ scope: 'archived', total: 0, items: [] }));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-products', { params: { scope: 'archived' } });
    expect(r.stdout).toContain('没有产品。');
    const bad = await ws(['products', '--scope', 'mine']);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain('--scope');
    expect(noHttpCalls(bad)).toBe(true);
  });

  it('null relations and org fall back to —; no note when every card was evaluated', async () => {
    const r = await ws(['products'], ok({ scope: 'all', total: 1, items: [card({ orgName: null, orgId: null, owned: null, participating: null, following: null })] }));
    expect(r.stdout).toMatch(/12\s+good7ob\s+—\s+active\s+—\s+8/);
    expect(r.stdout).not.toContain('只评估前 20');
  });

  it('a zero count is 0, not —', async () => {
    const r = await ws(['products'], ok({ scope: 'all', total: 1, items: [card({ myOpenTasks: 0, blockedCount: 0, aiWorkingCount: 0, progress: 0 })] }));
    expect(r.stdout).toMatch(/0\s+0\s+0\s+0%/);
  });

  it('--json and business errors', async () => {
    const a = await ws(['products', '--json'], ok({ scope: 'all', total: 0, items: [] }));
    expect(JSON.parse(a.stdout).scope).toBe('all');
    const b = await ws(['products'], bizError(1001, '未知的 scope'));
    expect(b.stderr).toContain('未知的 scope');
  });
});

describe('workspace product follow / unfollow', () => {
  it('follow POSTs /workspace/my-products/{id}/follow', async () => {
    const r = await ws(['product', 'follow', '12']);
    expect(r.http.post).toHaveBeenCalledWith('/workspace/my-products/12/follow', undefined);
    expect(r.stdout).toBe('✓ 已关注: 产品 #12');
  });

  it('unfollow DELETEs the same URL', async () => {
    const r = await ws(['product', 'unfollow', '12']);
    expect(r.http.delete).toHaveBeenCalledWith('/workspace/my-products/12/follow', undefined);
    expect(r.stdout).toBe('✓ 已取消关注: 产品 #12');
  });

  it('--json prints a small result when the backend returns no data', async () => {
    const r = await ws(['product', 'follow', '12', '--json']);
    expect(JSON.parse(r.stdout)).toEqual({ productId: 12, following: true });
    const u = await ws(['product', 'unfollow', '12', '--json']);
    expect(JSON.parse(u.stdout)).toEqual({ productId: 12, following: false });
  });

  it.each(['follow', 'unfollow'])('%s rejects a bad product id', async (verb) => {
    for (const bad of ['0', 'abc', '1.5', '9007199254740993']) {
      const r = await ws(['product', verb, bad]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('productId');
      expect(noHttpCalls(r)).toBe(true);
    }
  });

  it('maps 1002 (no such product) and 2000 (not a member)', async () => {
    const a = await ws(['product', 'follow', '99'], bizError(1002, '产品不存在'));
    expect(a.exitCode).toBe(1);
    expect(a.stderr).toContain('产品不存在');
    const b = await ws(['product', 'follow', '99'], bizError(2000, 'no'));
    expect(b.stderr).toContain('只能关注自己所在组织');
    const c = await ws(['product', 'unfollow', '99'], bizError(999, 'x'));
    expect(c.stderr).toContain('未登录');
  });
});

describe('workspace orgs', () => {
  it('GETs /workspace/my-orgs and renders the table', async () => {
    const r = await ws(['orgs'], ok({ total: 2, items: [
      { orgId: 3, name: 'RemoStudio', logoUrl: null, myRole: 'owner', memberCount: 5, aiEmployeeCount: 4, productCount: 2, activeTaskCount: 17 },
      { orgId: 4, name: '空组织', myRole: 'member', memberCount: 1, aiEmployeeCount: 0, productCount: 0, activeTaskCount: null },
    ] }));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-orgs', { params: undefined });
    expect(r.stdout).toMatch(/3\s+RemoStudio\s+owner\s+5\s+4\s+2\s+17/);
    expect(r.stdout).toMatch(/4\s+空组织\s+member\s+1\s+0\s+0\s+—/);
    expect(r.stdout).toContain('共 2 个组织');
  });

  it('empty list, --json, business error', async () => {
    expect((await ws(['orgs'], ok({ total: 0, items: [] }))).stdout).toContain('你还不是任何组织的成员');
    expect((await ws(['orgs'], ok(null))).exitCode).toBeUndefined();
    expect(JSON.parse((await ws(['orgs', '--json'], ok({ total: 0, items: [] }))).stdout).total).toBe(0);
    const err = await ws(['orgs'], bizError(500, '系统错误'));
    expect(err.exitCode).toBe(1);
    expect(err.stderr).toContain('系统错误');
  });
});
