import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerHealthCommands } from '../index';
import { downsample, progressBar, sparkline } from '../burnupChart';
import { bizError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerHealthCommands(program.command('pm'));
const burnup = (args: string[], response = ok(null)) => runCli(register, ['pm', 'health', 'burnup', '12', ...args], response);

afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await burnup(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const data = {
  productId: 12, releaseId: null, weightBasis: 'ESTIMATED_HOURS', from: '2026-09-17', to: '2026-09-19', baselineScope: 1000,
  points: [
    { date: '2026-09-17', scope: 1000, completed: 0, remaining: 1000 },
    { date: '2026-09-18', scope: 1280, completed: 640, remaining: 640 },
    { date: '2026-09-19', scope: 1300, completed: 1300, remaining: 0 },
  ],
};

describe('pm health burnup <productId>', () => {
  it('GETs with no params by default (server picks the last 30 days)', async () => {
    const r = await burnup([], ok(data));
    expect(r.http.get).toHaveBeenCalledWith('/progress/products/12/burnup', { params: {} });
    expect(r.exitCode).toBeUndefined();
  });

  it('passes --from / --to / --release', async () => {
    const r = await burnup(['--from', '2026-09-01', '--to', '2026-09-19', '--release', '5'], ok(data));
    expect(r.http.get).toHaveBeenCalledWith('/progress/products/12/burnup', { params: { from: '2026-09-01', to: '2026-09-19', releaseId: 5 } });
  });

  it('renders header, sparklines and a table with a real 0 kept as 0', async () => {
    const out = (await burnup([], ok(data))).stdout;
    expect(out).toContain('2026-09-17 → 2026-09-19');
    expect(out).toContain('ESTIMATED_HOURS (h)');
    expect(out).toMatch(/基线范围 1000/);
    expect(out).toMatch(/范围 {3}\S{3}\s+\(max 1300\)/);
    expect(out).toMatch(/2026-09-17\s+1000\s+0\s+1000\s+░{20}/);
    expect(out).toMatch(/2026-09-18\s+1280\s+640\s+640\s+█{10}░{10}/);
    expect(out).toMatch(/2026-09-19\s+1300\s+1300\s+0\s+█{20}/);
    expect(out).toContain('共 3 个数据点');
  });

  it('shows — for a missing baseline / null cells and labels the release', async () => {
    const out = (await burnup(['--release', '5'], ok({ ...data, releaseId: 5, baselineScope: null, points: [{ date: '2026-09-19', scope: null, completed: null, remaining: null }] }))).stdout;
    expect(out).toContain('Release #5');
    expect(out).toMatch(/基线范围 —/);
    expect(out).toMatch(/2026-09-19\s+—\s+—\s+—/);
  });

  it('explains an empty series instead of drawing nothing', async () => {
    const out = (await burnup([], ok({ ...data, points: [] }))).stdout;
    expect(out).toContain('没有快照数据');
    expect(out).toContain('snapshots rebuild');
    expect((await burnup([], ok(null))).exitCode).toBeUndefined();
  });

  it('--json is the raw payload', async () => {
    expect(JSON.parse((await burnup(['--json'], ok(data))).stdout).points).toHaveLength(3);
  });

  it.each([
    [['--from', '2026-9-1'], '--from'],
    [['--to', '2026-02-30'], '--to'],
    [['--from', '2026-09-19', '--to', '2026-09-18'], '不能晚于'],
    [['--from', '2025-01-01', '--to', '2026-09-19'], '366'],
    [['--release', 'abc'], '--release'],
  ])('rejects %j locally', async (flags, needle) => {
    await expectRejected(flags, needle);
  });

  it('accepts the same day and exactly 366 days', async () => {
    expect((await burnup(['--from', '2026-09-19', '--to', '2026-09-19'], ok(data))).http.get).toHaveBeenCalledTimes(1);
    expect((await burnup(['--from', '2025-09-19', '--to', '2026-09-20'], ok(data))).http.get).toHaveBeenCalledTimes(1);
  });

  it.each([[1001, '参数值不合法'], [1002, '不存在'], [2000, '组织的成员']])('maps business error %i', async (code, text) => {
    const r = await burnup([], bizError(code, 'nope'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
  });

  it('down-samples a long series in the chart only, and says so', async () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ date: `d${i}`, scope: 100, completed: i, remaining: 100 - i }));
    const out = (await burnup([], ok({ ...data, points }))).stdout;
    expect(out).toContain('共 100 个数据点（上方走势图已抽样为 60 点）');
    expect(out).toContain('d99');
  });
});

describe('burnupChart', () => {
  it('sparkline scales to the ceiling, leaves gaps for null, handles a zero ceiling', () => {
    expect(sparkline([0, 50, 100], 100)).toBe('▁▅█');
    expect(sparkline([null, undefined, 100], 100)).toBe('  █');
    expect(sparkline([0, 0], 0)).toBe('▁▁');
    expect(sparkline([500], 100)).toBe('█');
  });

  it('progressBar is empty when scope is unknown or zero, and clamps', () => {
    expect(progressBar(null, 10)).toBe('');
    expect(progressBar(5, 0)).toBe('');
    expect(progressBar(5, 10, 4)).toBe('██░░');
    expect(progressBar(99, 10, 4)).toBe('████');
  });

  it('downsample keeps first and last', () => {
    const v = Array.from({ length: 200 }, (_, i) => i);
    const s = downsample(v, 10);
    expect(s).toHaveLength(10);
    expect([s[0], s[9]]).toEqual([0, 199]);
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
});
