import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerIdeaCommands } from '../index';
import { parseMetric } from '../reviewInput';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const review = (args: string[], response = ok(null)) => runCli(registerIdeaCommands, ['idea', 'review', ...args], response);

afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await review(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const full = {
  review: {
    id: 3, ideaId: 21, releaseId: 7, status: 'draft',
    expected: {
      solutionId: 33, solutionName: '方案 A', effortDays: 11.5, cycleWeeks: 3, cost: 30000,
      rawEffortDays: 10, rawCycleWeeks: 2.5, rawCost: 24000,
      kpis: [{ name: '对账耗时', current: '5h', target: '2h', unit: '小时' }],
    },
    actualEffortDays: 13, actualCycleWeeks: 3.9, actualCost: null, notes: '复盘备注', reviewedBy: null, reviewedAt: null,
  },
  metrics: [{ id: 1, name: '对账耗时', expected: 2, actual: 3, unit: '小时', accuracyPct: 50 }, { id: 2, name: 'NPS', expected: 40, actual: null, unit: null, accuracyPct: null }],
  accuracy: { effortAccuracyPct: 86.96, scheduleAccuracyPct: 70, costAccuracyPct: null, effectAccuracyPct: 50 },
};

describe('idea review start / get / complete', () => {
  it('start POSTs and renders expected (with AI raw), actual, accuracy and metrics; null -> "—"', async () => {
    const r = await review(['start', '21'], ok(full));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/21/effect-review', undefined);
    expect(r.stdout).toContain('效果复盘 — Idea #21');
    expect(r.stdout).toContain('发布: #7');
    expect(r.stdout).toContain('选定方案 #33 方案 A');
    expect(r.stdout).toContain('11.5（AI 修正前 10）');
    expect(r.stdout).toContain('3 周（AI 修正前 2.5 周）');
    expect(r.stdout).toContain('对账耗时 5h → 2h 小时');
    expect(r.stdout).toContain('人日: 13    周期: 3.9 周    成本: —');
    expect(r.stdout).toContain('人日: 86.96%    进度: 70%    成本: —    效果: 50%');
    expect(r.stdout).toContain('草稿为实时计算');
    expect(r.stdout).toMatch(/NPS\s+40\s+—\s+—\s+—/);
    expect(r.stdout).toContain('复盘备注');
  });

  it('a review with nothing collected yet renders every value as "—", never 0', async () => {
    const r = await review(['get', '21'], ok({ review: { ideaId: 21, status: 'draft', expected: null }, metrics: null, accuracy: null }));
    expect(r.http.get).toHaveBeenCalledWith('/forge/ideas/21/effect-review', { params: undefined });
    expect(r.stdout).toContain('人日: —    周期: —    成本: —');
    expect(r.stdout).toContain('人日: —    进度: —    成本: —    效果: —');
    expect(r.stdout).toContain('没有选定方案');
    expect(r.stdout).toContain('暂无');
    expect(r.stdout).toContain('发布: —');
  });

  it('get maps 1002 (no review yet) to a pointer to start', async () => {
    const r = await review(['get', '21'], bizError(1002, 'no review'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('idea review start');
  });

  it('start maps 1007; --json prints the raw response', async () => {
    expect((await review(['start', '21'], bizError(1007, 'idea is draft'))).stderr).toContain('planning/developing/released');
    expect(JSON.parse((await review(['start', '21', '--json'], ok(full))).stdout)).toEqual(full);
  });

  it('complete POSTs to /complete and shows the frozen state', async () => {
    const done = { ...full, review: { ...full.review, status: 'completed', reviewedBy: 11, reviewedAt: '2026-09-19 10:30:00' } };
    const r = await review(['complete', '21'], ok(done));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/21/effect-review/complete', undefined);
    expect(r.stdout).toContain('效果复盘已完成，Idea 已 validated');
    expect(r.stdout).toContain('完成时冻结');
    expect(r.stdout).toContain('2026-09-19 10:30:00 by 11');
    expect((await review(['complete', '21'], bizError(1007, 'not released'))).stderr).toContain('须为 released');
  });

  it('rejects a bad ideaId', async () => {
    for (const sub of ['start', 'get', 'complete']) await expectRejected([sub, 'abc'], 'ideaId');
    await expectRejected(['metrics', '0', '--notes', 'n'], 'ideaId');
  });
});

describe('--metric parsing', () => {
  it('parses name:expected:actual:unit, blanks -> null', () => {
    expect(parseMetric('对账耗时:2:3:小时')).toEqual({ name: '对账耗时', expected: 2, actual: 3, unit: '小时' });
    expect(parseMetric('NPS:40::pts')).toEqual({ name: 'NPS', expected: 40, actual: null, unit: 'pts' });
    expect(parseMetric('NPS::35')).toEqual({ name: 'NPS', expected: null, actual: 35, unit: null });
    expect(parseMetric('NPS')).toEqual({ name: 'NPS', expected: null, actual: null, unit: null });
    expect(parseMetric(' rate : -1.5 : 0.0001 : % ')).toEqual({ name: 'rate', expected: -1.5, actual: 0.0001, unit: '%' });
    expect(parseMetric('x:1.50000:2:u').expected).toBe(1.5);
  });

  it.each([
    ['', 'name'],
    [':1:2', 'name'],
    ['a:b:2', 'expected'],
    ['a:1:2x', 'actual'],
    ['a:1e3:2', 'expected'],
    ['a:1.23456:2', '4 位小数'],
    ['a:1:2.00001', '4 位小数'],
    ['a:123456789012345:2', '超出范围'],
    ['a:1:2:u:extra', '格式'],
    [`${'n'.repeat(101)}:1:2`, 'name'],
    [`n:1:2:${'u'.repeat(21)}`, 'unit'],
  ])('rejects %j', (raw, needle) => {
    expect(() => parseMetric(raw)).toThrow(needle);
  });

  it('accepts a 100-char name, a 20-char unit and the 14-digit maximum', () => {
    expect(parseMetric(`${'n'.repeat(100)}:99999999999999:1:${'u'.repeat(20)}`).unit).toHaveLength(20);
  });
});

describe('idea review metrics', () => {
  it('PUTs the parsed metrics list (repeatable) plus notes', async () => {
    const r = await review(['metrics', '21', '--metric', '对账耗时:2:3:小时', '--metric', 'NPS:40::pts', '--notes', '复盘备注'], ok(full));
    expect(r.http.put).toHaveBeenCalledWith('/forge/ideas/21/effect-review', {
      metrics: [
        { name: '对账耗时', expected: 2, actual: 3, unit: '小时' },
        { name: 'NPS', expected: 40, actual: null, unit: 'pts' },
      ],
      notes: '复盘备注',
    });
    expect(r.stdout).toContain('效果复盘 — Idea #21');
  });

  it('notes only leaves metrics out (unchanged); empty notes are allowed; --clear-metrics sends []', async () => {
    const notes = await review(['metrics', '21', '--notes', 'n'], ok(full));
    expect(notes.http.put).toHaveBeenCalledWith('/forge/ideas/21/effect-review', { notes: 'n' });
    const blank = await review(['metrics', '21', '--notes', ''], ok(full));
    expect(blank.http.put).toHaveBeenCalledWith('/forge/ideas/21/effect-review', { notes: '' });
    const clear = await review(['metrics', '21', '--clear-metrics'], ok(full));
    expect(clear.http.put).toHaveBeenCalledWith('/forge/ideas/21/effect-review', { metrics: [] });
  });

  it('rejects nothing-to-change, conflicts, > 20 metrics, > 2000 notes and bad metrics before any HTTP call', async () => {
    await expectRejected(['metrics', '21'], '至少指定');
    await expectRejected(['metrics', '21', '--metric', 'a:1:2', '--clear-metrics'], '不能同时使用');
    await expectRejected(['metrics', '21', ...Array.from({ length: 21 }, (_, i) => ['--metric', `m${i}:1:2`]).flat()], '最多 20 项');
    await expectRejected(['metrics', '21', '--notes', 'x'.repeat(2001)], '--notes');
    await expectRejected(['metrics', '21', '--metric', 'a:x:2'], 'expected');
  });

  it('accepts exactly 20 metrics and 2000 chars of notes', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ['--metric', `m${i}:1:2`]).flat();
    expect((await review(['metrics', '21', ...twenty, '--notes', 'x'.repeat(2000)], ok(full))).exitCode).toBeUndefined();
  });

  it('maps 1001 (with the server message) and 1007 (already completed)', async () => {
    const bad = await review(['metrics', '21', '--metric', 'a:1:2'], bizError(1001, '指标名称重复'));
    expect(bad.stderr).toContain('参数值不合法');
    expect(bad.stderr).toContain('指标名称重复');
    expect((await review(['metrics', '21', '--notes', 'n'], bizError(1007, 'completed'))).stderr).toContain('已完成的复盘不可再修改');
  });
});
