import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerHealthCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerHealthCommands(program.command('pm'));
const health = (args: string[], response = ok(null)) => runCli(register, ['pm', 'health', ...args], response);

afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await health(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const auto = {
  id: 4, productId: 12, releaseId: null, changedAt: '2026-09-18T23:50:00Z', deltaScope: 30, scopeAfter: 130, weightBasis: 'ESTIMATED_HOURS',
  kind: 'auto', reason: null, addedTaskIds: [8, 9], removedTaskIds: [5], createdBy: null,
};
const manual = {
  id: 3, productId: 12, releaseId: 5, changedAt: '2026-09-17T10:00:00Z', deltaScope: -12.5, scopeAfter: 100, weightBasis: 'ESTIMATED_HOURS',
  kind: 'manual', reason: '砍掉导出', addedTaskIds: [], removedTaskIds: [], createdBy: 11,
};
const page = { records: [auto, manual], total: 23, current: 1, size: 20, pages: 2 };

describe('pm health scope-changes <productId>', () => {
  it('GETs with the default paging and renders the table', async () => {
    const r = await health(['scope-changes', '12'], ok(page));
    expect(r.http.get).toHaveBeenCalledWith('/progress/products/12/scope-changes', { params: { pageNum: 1, pageSize: 20 } });
    expect(r.stdout).toMatch(/4\s+2026-09-18 23:50:00Z\s+auto\s+\+30\s+130\s+ESTIMATED_HOURS\s+—\s+\+2\/-1\s+—/);
    expect(r.stdout).toMatch(/3\s+2026-09-17 10:00:00Z\s+manual\s+-12\.5\s+100\s+ESTIMATED_HOURS\s+5\s+—\s+砍掉导出/);
    expect(r.stdout).toContain('共 23 条，第 1/2 页');
  });

  it('passes --release, -p and --page-size', async () => {
    const r = await health(['scope-changes', '12', '--release', '5', '-p', '2', '--page-size', '100'], ok(page));
    expect(r.http.get).toHaveBeenCalledWith('/progress/products/12/scope-changes', { params: { pageNum: 2, pageSize: 100, releaseId: 5 } });
  });

  it('handles an empty page / null body, and --json', async () => {
    expect((await health(['scope-changes', '12'], ok({ records: [], total: 0 }))).stdout).toContain('没有范围变更记录');
    expect((await health(['scope-changes', '12'], ok(null))).stdout).toContain('没有范围变更记录');
    expect(JSON.parse((await health(['scope-changes', '12', '--json'], ok(page))).stdout).total).toBe(23);
  });

  it.each([
    [['--page', '0'], '--page'],
    [['--page', 'x'], '--page'],
    [['--page-size', '0'], '--page-size'],
    [['--page-size', '101'], '--page-size'],
    [['--release', 'abc'], '--release'],
  ])('rejects %j locally', async (flags, needle) => {
    await expectRejected(['scope-changes', '12', ...flags], needle);
  });

  it.each([[1002, '不存在'], [2000, '组织的成员']])('maps business error %i', async (code, text) => {
    const r = await health(['scope-changes', '12'], bizError(code));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
  });
});

describe('pm health scope-change add <productId>', () => {
  const add = (args: string[], response = ok(manual)) => health(['scope-change', 'add', '12', ...args], response);

  it('POSTs deltaScope as a number, with a trimmed reason', async () => {
    const r = await add(['--delta', '30', '--reason', '  新增导出  ']);
    expect(r.http.post).toHaveBeenCalledWith('/progress/products/12/scope-changes', { deltaScope: 30, reason: '新增导出' });
    expect(r.stdout).toContain('已记录  #3');
    expect(r.stdout).toMatch(/变化\s+-12\.5 ESTIMATED_HOURS \(h\)/);
  });

  it('accepts negative / decimal / --delta=+n forms and --release', async () => {
    expect((await add(['--delta', '-12.5', '--reason', 'r'])).http.post).toHaveBeenCalledWith(expect.anything(), { deltaScope: -12.5, reason: 'r' });
    expect((await add(['--delta=+7', '--reason', 'r', '--release', '5'])).http.post)
      .toHaveBeenCalledWith(expect.anything(), { deltaScope: 7, reason: 'r', releaseId: 5 });
  });

  it('accepts a 500-char reason, rejects 501', async () => {
    expect((await add(['--delta', '1', '--reason', 'x'.repeat(500)])).http.post).toHaveBeenCalledTimes(1);
    await expectRejected(['scope-change', 'add', '12', '--delta', '1', '--reason', 'x'.repeat(501)], '--reason');
  });

  it.each([
    ['0', '非零'],
    ['0.001', '非零'],
    ['-0', '非零'],
    ['10000000000', '10^10'],
    ['abc', '--delta'],
    ['1e3', '--delta'],
    ['', '--delta'],
  ])('rejects --delta %j locally', async (delta, needle) => {
    await expectRejected(['scope-change', 'add', '12', '--delta', delta, '--reason', 'r'], needle);
  });

  it('requires --delta and a non-blank --reason; rejects a bad --release', async () => {
    const noDelta = await add(['--reason', 'r']);
    expect(noDelta.exitCode).toBe(1);
    expect(noDelta.stderr).toContain('--delta');
    expect(noHttpCalls(noDelta)).toBe(true);
    const noReason = await add(['--delta', '1']);
    expect(noReason.exitCode).toBe(1);
    expect(noReason.stderr).toContain('--reason');
    await expectRejected(['scope-change', 'add', '12', '--delta', '1', '--reason', '   '], '--reason');
    await expectRejected(['scope-change', 'add', '12', '--delta', '1', '--reason', 'r', '--release', '0'], '--release');
  });

  it('supports --json and maps 1001 / 1002 / 2000 with the server message kept', async () => {
    expect(JSON.parse((await add(['--delta', '1', '--reason', 'r', '--json'])).stdout).kind).toBe('manual');
    const bad = await add(['--delta', '1', '--reason', 'r', '--release', '9'], bizError(1001, 'release 不属于该产品'));
    expect(bad.stderr).toContain('参数值不合法');
    expect(bad.stderr).toContain('release 不属于该产品');
    expect((await add(['--delta', '1', '--reason', 'r'], bizError(2000))).stderr).toContain('组织的成员');
    expect((await add(['--delta', '1', '--reason', 'r'], bizError(1002))).stderr).toContain('不存在');
  });
});

describe('pm health scope-change annotate <id>', () => {
  const annotate = (args: string[], response = ok({ ...auto, reason: '需求追加' })) => health(['scope-change', 'annotate', '4', ...args], response);

  it('PUTs the reason to /progress/scope-changes/{id}', async () => {
    const r = await annotate(['--reason', ' 需求追加 ']);
    expect(r.http.put).toHaveBeenCalledWith('/progress/scope-changes/4', { reason: '需求追加' });
    expect(r.stdout).toContain('已更新  #4');
    expect(r.stdout).toMatch(/原因\s+需求追加/);
  });

  it('validates id and reason locally', async () => {
    await expectRejected(['scope-change', 'annotate', 'x', '--reason', 'r'], 'id');
    await expectRejected(['scope-change', 'annotate', '4', '--reason', ' '], '--reason');
    await expectRejected(['scope-change', 'annotate', '4', '--reason', 'x'.repeat(501)], '--reason');
    const missing = await annotate([]);
    expect(missing.exitCode).toBe(1);
    expect(noHttpCalls(missing)).toBe(true);
  });

  it('--json and business errors', async () => {
    expect(JSON.parse((await annotate(['--reason', 'r', '--json'])).stdout).id).toBe(4);
    expect((await annotate(['--reason', 'r'], bizError(1002, '范围变更记录不存在: 4'))).stderr).toContain('范围变更记录不存在: 4');
    expect((await annotate(['--reason', 'r'], bizError(2000))).stderr).toContain('组织的成员');
  });
});
