import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerHealthCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerHealthCommands(program.command('pm'));
const health = (args: string[], response = ok(null)) => runCli(register, ['pm', 'health', ...args], response);

afterEach(() => vi.restoreAllMocks());

/** A client-side rejection: exit 1, "参数错误", the offending flag named, and no HTTP call. */
async function expectRejected(args: string[], needle: string) {
  const r = await health(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const DEFAULTS = {
  not_started: 0, pending_agent: 0, pending_info: 0, awaiting_plan_approval: 10, in_progress: 30, awaiting_completion_approval: 90,
};
const cfg = {
  productId: 12, configured: true, weightBasis: 'STORY_POINT', statusCompletion: { in_progress: 40 },
  effectiveStatusCompletion: { ...DEFAULTS, in_progress: 40 }, defaultStatusCompletion: DEFAULTS,
  updatedBy: 11, updatedAt: '2026-09-19T10:00:00Z',
};

describe('pm health config get <productId>', () => {
  it('GETs /config and shows basis, default / effective / override per status', async () => {
    const r = await health(['config', 'get', '12'], ok(cfg));
    expect(r.http.get).toHaveBeenCalledWith('/progress/products/12/config', { params: undefined });
    expect(r.stdout).toContain('STORY_POINT (SP)');
    expect(r.stdout).toMatch(/in_progress\s+30%\s+40%\s+40%/);
    expect(r.stdout).toMatch(/not_started\s+0%\s+0%\s+—/);
    expect(r.stdout).toContain('2026-09-19 10:00:00Z by 11');
    expect(r.stdout).not.toContain('未配置');
  });

  it('says so when the product was never configured (null updatedAt -> —)', async () => {
    const r = await health(['config', 'get', '12'], ok({ ...cfg, configured: false, statusCompletion: {}, updatedBy: null, updatedAt: null }));
    expect(r.stdout).toContain('未配置，使用默认值');
    expect(r.stdout).toMatch(/更新\s+—/);
  });

  it('survives an empty body, supports --json, rejects a bad id', async () => {
    expect((await health(['config', 'get', '12'], ok(null))).exitCode).toBeUndefined();
    expect(JSON.parse((await health(['config', 'get', '12', '--json'], ok(cfg))).stdout).weightBasis).toBe('STORY_POINT');
    expect(JSON.parse((await health(['--json', 'config', 'get', '12'], ok(cfg))).stdout).productId).toBe(12);
    await expectRejected(['config', 'get', 'abc'], 'productId');
  });

  it.each([
    [1002, '不存在'],
    [2000, '不是该产品所属组织的成员'],
    [999, '未登录'],
  ])('maps business error %i', async (code, text) => {
    const r = await health(['config', 'get', '12'], bizError(code, 'server says no'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain('server says no');
  });

  it('does not apply the old 40xxx table to the new endpoints', async () => {
    const r = await health(['config', 'get', '12'], bizError(40380, 'legacy'));
    expect(r.stderr).toContain('legacy (code=40380)');
  });
});

describe('pm health config set <productId>', () => {
  const set = (args: string[], response = ok(cfg)) => health(['config', 'set', '12', ...args], response);

  it('PUTs the basis alone (no statusCompletion key: replace clears overrides)', async () => {
    const r = await set(['--basis', 'STORY_POINT']);
    expect(r.http.put).toHaveBeenCalledWith('/progress/products/12/config', { weightBasis: 'STORY_POINT' });
    expect(r.stdout).toContain('已保存');
    expect(r.exitCode).toBeUndefined();
  });

  it('normalises the basis case and parses --status-completion', async () => {
    const r = await set(['--basis', ' estimated_hours ', '--status-completion', 'in_progress=30, BLOCKED=12.5,paused=0']);
    expect(r.http.put).toHaveBeenCalledWith('/progress/products/12/config', {
      weightBasis: 'ESTIMATED_HOURS', statusCompletion: { in_progress: 30, blocked: 12.5, paused: 0 },
    });
  });

  it('accepts the 0 and 100 boundaries', async () => {
    const r = await set(['--basis', 'WEIGHT', '--status-completion', 'in_progress=100,blocked=0']);
    expect(r.http.put).toHaveBeenCalledTimes(1);
  });

  it('--json prints the saved config', async () => {
    expect(JSON.parse((await set(['--basis', 'WEIGHT', '--json'])).stdout).effectiveStatusCompletion.in_progress).toBe(40);
  });

  it('requires --basis and only accepts the three bases', async () => {
    const missing = await set([]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('--basis');
    expect(noHttpCalls(missing)).toBe(true);
    await expectRejected(['config', 'set', '12', '--basis', 'HOURS'], '--basis');
  });

  it.each([
    ['in_progress', '状态=完成度'],
    ['in_progress=', '状态=完成度'],
    ['=30', '状态=完成度'],
    ['in_progress=1=2', '状态=完成度'],
    ['nope=10', '状态'],
    ['completed=50', 'completed'],
    ['Cancelled=0', 'cancelled'],
    ['in_progress=101', '0 到 100'],
    ['in_progress=-1', '0 到 100'],
    ['in_progress=abc', '0 到 100'],
    ['in_progress=10,in_progress=20', '重复'],
    ['', '状态=完成度'],
  ])('rejects --status-completion %j locally', async (value, needle) => {
    await expectRejected(['config', 'set', '12', '--basis', 'WEIGHT', '--status-completion', value], needle);
  });

  it('maps 2000 (not owner/admin) and surfaces the server message for 1001', async () => {
    const denied = await set(['--basis', 'WEIGHT'], bizError(2000, '仅组织 owner/admin 可修改进度配置'));
    expect(denied.stderr).toContain('owner/admin');
    const bad = await set(['--basis', 'WEIGHT'], bizError(1001, '未知的任务状态: x'));
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain('未知的任务状态: x');
  });
});

describe('pm health snapshots rebuild <productId>', () => {
  const result = { days: 30, from: '2026-08-20', to: '2026-09-18', created: 29, skipped: 1 };
  const rebuild = (args: string[], response = ok(result)) => health(['snapshots', 'rebuild', '10', ...args], response);

  it('POSTs without a query when --days is omitted (server default 30)', async () => {
    const r = await rebuild([]);
    expect(r.http.post).toHaveBeenCalledWith('/progress/products/10/snapshots/rebuild', undefined);
    expect(r.stdout).toContain('2026-08-20 → 2026-09-18');
    expect(r.stdout).toMatch(/新建\s+29/);
    expect(r.stdout).toMatch(/跳过，不覆盖\）\s+1/);
  });

  it('passes --days as a query parameter, accepting 1 and 90', async () => {
    expect((await rebuild(['--days', '7'])).http.post).toHaveBeenCalledWith('/progress/products/10/snapshots/rebuild?days=7', undefined);
    expect((await rebuild(['--days', '1'])).http.post).toHaveBeenCalledTimes(1);
    expect((await rebuild(['--days', '90'])).http.post).toHaveBeenCalledTimes(1);
  });

  it.each(['0', '91', '-3', 'x', '1.5'])('rejects --days %s locally', async (days) => {
    await expectRejected(['snapshots', 'rebuild', '10', '--days', days], '--days');
  });

  it('renders nulls as — and supports --json', async () => {
    expect((await rebuild([], ok({ days: 30 }))).stdout).toMatch(/新建\s+—/);
    expect(JSON.parse((await rebuild(['--json'])).stdout).created).toBe(29);
  });

  it.each([
    [2000, '组织的成员'],
    [1001, '参数值不合法'],
    [1002, '不存在'],
  ])('maps business error %i', async (code, text) => {
    const r = await rebuild([], bizError(code, 'nope'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
  });
});
