/** `good7ob deliverable` (成果物台账): request shapes, input validation before any HTTP call, rendering. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDeliverableCommands } from '../index';
import { periodRange, resolvePeriod } from '../logic';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

afterEach(() => vi.restoreAllMocks());

const run = (args: string[], response = ok(null) as ReturnType<typeof ok>) => runCli(registerDeliverableCommands, ['deliverable', ...args], response);

describe('periods (JST)', () => {
  // 2026-10-21 (Wednesday) 12:00 JST = 03:00 UTC
  const now = Date.UTC(2026, 9, 21, 3, 0, 0);

  it('today, Monday..today and 1st..today', () => {
    expect(periodRange('today', now)).toEqual({ from: '2026-10-21', to: '2026-10-21' });
    expect(periodRange('week', now)).toEqual({ from: '2026-10-19', to: '2026-10-21' });
    expect(periodRange('month', now)).toEqual({ from: '2026-10-01', to: '2026-10-21' });
  });

  it('uses the Tokyo day even when UTC is still the day before', () => {
    // 2026-10-21 00:30 JST = 2026-10-20 15:30 UTC
    expect(periodRange('today', Date.UTC(2026, 9, 20, 15, 30))).toEqual({ from: '2026-10-21', to: '2026-10-21' });
  });

  it('a Sunday belongs to the week that began on Monday', () => {
    expect(periodRange('week', Date.UTC(2026, 9, 25, 3, 0))).toEqual({ from: '2026-10-19', to: '2026-10-25' });
  });

  it('rejects --period together with --from/--to, a reversed range and a bad day', () => {
    expect(() => resolvePeriod({ period: 'week', from: '2026-10-01' })).toThrow('不能与');
    expect(() => resolvePeriod({ from: '2026-10-21', to: '2026-10-01' })).toThrow('不能早于');
    expect(() => resolvePeriod({ from: '2026-02-30' })).toThrow('有效日期');
    expect(() => resolvePeriod({ period: 'year' })).toThrow('取值无效');
    expect(resolvePeriod({})).toEqual({ from: undefined, to: undefined });
  });
});

describe('deliverable collect', () => {
  it('posts product and period and prints the per-kind counts', async () => {
    const r = await run(['collect', '--product', '10', '--from', '2026-10-01', '--to', '2026-10-21'],
      ok({ productId: 10, from: '2026-10-01', to: '2026-10-21', inserted: 3, byKind: { pull_request: 2, task: 1, plan: 0 } }));

    expect(r.exitCode).toBeUndefined();
    const [url, body] = r.http.post.mock.calls[0];
    expect(url).toBe('/progress/deliverables/collect');
    expect(body).toEqual({ productId: 10, from: '2026-10-01', to: '2026-10-21' });
    expect(r.stdout).toContain('新增 3 条');
    expect(r.stdout).toContain('合并 PR 2');
    expect(r.stdout).toContain('任务完成 1');
    expect(r.stdout).not.toContain('计划');
  });

  it('refuses a missing product and a bad period before any HTTP call', async () => {
    delete process.env.GOOD7OB_PRODUCT_ID;
    const noProduct = await run(['collect']);
    expect(noProduct.exitCode).toBe(1);
    expect(noProduct.stderr).toContain('GOOD7OB_PRODUCT_ID');
    expect(noHttpCalls(noProduct)).toBe(true);

    const bad = await run(['collect', '--product', '10', '--period', 'year']);
    expect(bad.exitCode).toBe(1);
    expect(noHttpCalls(bad)).toBe(true);
  });

  it('maps 2000 to a readable no-access message', async () => {
    const r = await run(['collect', '--product', '10'], bizError(2000, '无权访问该产品') as never);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('无权访问该产品');
  });
});

describe('deliverable list', () => {
  const ledger = {
    productId: 10, from: '2026-10-21', to: '2026-10-21', total: 3,
    groups: [
      { kind: 'pull_request', count: 2, items: [{ id: 1, kind: 'pull_request', action: 'merged', title: 'feat: x', url: 'https://g/1', actorName: 'Jian', occurredAt: Date.UTC(2026, 9, 21, 1, 0), sourceRef: 'intg_pull_request:1' }] },
      { kind: 'task', count: 1, items: [{ id: 2, kind: 'task', action: 'completed', title: 't', url: null, actorName: null, occurredAt: Date.UTC(2026, 9, 21, 2, 0), sourceRef: 'pm_task_state_history:2' }] },
    ],
  };

  it('gets the ledger with the period and limit and groups the output, showing the truncation note', async () => {
    const r = await run(['list', '--product', '10', '--from', '2026-10-21', '--limit', '1'], ok(ledger));

    const [url, params] = r.http.get.mock.calls[0];
    expect(url).toBe('/progress/deliverables');
    expect((params as { params: unknown }).params).toMatchObject({ productId: 10, from: '2026-10-21', limitPerKind: 1 });
    expect(r.stdout).toContain('共 3 项');
    expect(r.stdout).toContain('■ 合并 PR（2，仅显示前 1 条）');
    expect(r.stdout).toContain('■ 任务完成（1）');
    expect(r.stdout).toContain('2026-10-21 10:00:00');
  });

  it('--kind keeps one group and recomputes the total; an unknown kind or bad limit is refused', async () => {
    const r = await run(['list', '--product', '10', '--kind', 'task', '--json'], ok(ledger));
    const shown = JSON.parse(r.stdout);
    expect(shown.groups.map((g: { kind: string }) => g.kind)).toEqual(['task']);
    expect(shown.total).toBe(1);

    expect((await run(['list', '--product', '10', '--kind', 'bogus'])).exitCode).toBe(1);
    const badLimit = await run(['list', '--product', '10', '--limit', '0']);
    expect(badLimit.exitCode).toBe(1);
    expect(noHttpCalls(badLimit)).toBe(true);
  });

  it('says so when the period has no deliverables', async () => {
    const r = await run(['list', '--product', '10'], ok({ productId: 10, from: '2026-10-21', to: '2026-10-21', total: 0, groups: [] }));
    expect(r.stdout).toContain('没有成果物');
  });
});

describe('deliverable add', () => {
  const created = { id: 9, kind: 'api_design', action: 'created', title: '外部 API 文档', sourceRef: 'manual:abc' };

  it('posts the registration and prints the new id and source', async () => {
    const r = await run(['add', '--product', '10', '--kind', 'api_design', '--title', ' 外部 API 文档 ',
      '--url', 'https://example.com/d', '--at', '2026-10-20', '--detail', '{"version":"1.0.0"}'], ok(created));

    expect(r.exitCode).toBeUndefined();
    const [url, body] = r.http.post.mock.calls[0];
    expect(url).toBe('/progress/deliverables');
    expect(body).toEqual({
      productId: 10, kind: 'api_design', title: ' 外部 API 文档 ', url: 'https://example.com/d', action: undefined,
      occurredAt: '2026-10-20', detail: { version: '1.0.0' },
    });
    expect(r.stdout).toContain('#9');
    expect(r.stdout).toContain('manual:abc');
  });

  it('keeps a date-time as given and refuses bad kind / time / detail / empty title before any HTTP call', async () => {
    const timed = await run(['add', '--product', '10', '--kind', 'task', '--title', 't', '--at', '2026-10-20 09:30'], ok(created));
    expect((timed.http.post.mock.calls[0][1] as { occurredAt: string }).occurredAt).toBe('2026-10-20T09:30');

    for (const args of [
      ['--kind', 'bogus', '--title', 't'],
      ['--kind', 'task', '--title', '   '],
      ['--kind', 'task', '--title', 't', '--at', 'yesterday'],
      ['--kind', 'task', '--title', 't', '--detail', '[1]'],
      ['--kind', 'task', '--title', 't', '--detail', '{oops'],
      ['--kind', 'task', '--title', 'x'.repeat(501)],
    ]) {
      const r = await run(['add', '--product', '10', ...args]);
      expect(r.exitCode, args.join(' ')).toBe(1);
      expect(noHttpCalls(r), args.join(' ')).toBe(true);
    }
  });

  it('requires --kind and --title', async () => {
    const r = await run(['add', '--product', '10']);
    expect(r.exitCode).toBeGreaterThan(0);
    expect(noHttpCalls(r)).toBe(true);
  });
});
