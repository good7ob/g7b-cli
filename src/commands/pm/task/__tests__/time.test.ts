import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerTaskCommands } from '../index';
import { registerProjectCommands } from '../../project';
import { bizError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';
import { fmtDuration, fmtRatio, parseAllocations, parseDuration, parseInstant } from '../timeFormat';

const register = (program: Command) => {
  const pm = program.command('pm');
  registerTaskCommands(pm);
  registerProjectCommands(pm);
};
const cli = (args: string[], response = ok(null)) => runCli(register, ['pm', ...args], response);

afterEach(() => vi.restoreAllMocks());

describe('helpers', () => {
  it('formats durations', () => {
    expect(fmtDuration(6300)).toBe('1h45m');
    expect(fmtDuration(3661)).toBe('1h1m1s');
    expect(fmtDuration(0)).toBe('0s');
    expect(fmtDuration(null)).toBe('—');
  });
  it('formats ratios', () => {
    expect(fmtRatio(1.167)).toBe('116.7%');
    expect(fmtRatio(null)).toBe('—');
  });
  it('parses durations and rejects unit-less input', () => {
    expect(parseDuration('1h30m', '--work')).toBe(5400);
    expect(parseDuration('90m', '--work')).toBe(5400);
    expect(parseDuration('45s', '--work')).toBe(45);
    for (const bad of ['90', '', 'abc', '1.5h', '-1h']) expect(() => parseDuration(bad, '--work')).toThrow('--work');
  });
  it('parses instants (epoch ms, ISO, zoneless = JST)', () => {
    expect(parseInstant('1761350400000', '--started-at')).toBe(1761350400000);
    expect(parseInstant('2026-10-25T09:00:00+09:00', 'x')).toBe(Date.parse('2026-10-25T00:00:00Z'));
    expect(parseInstant('2026-10-25 09:00:00', 'x')).toBe(Date.parse('2026-10-25T00:00:00Z'));
    expect(() => parseInstant('yesterday', 'x')).toThrow();
  });
  it('parses allocations', () => {
    expect(parseAllocations(['1950', '1951'])).toEqual([{ taskId: 1950 }, { taskId: 1951 }]);
    expect(parseAllocations(['1950:2', '1951:1'])).toEqual([{ taskId: 1950, weight: 2 }, { taskId: 1951, weight: 1 }]);
    for (const bad of [[], ['1950:2', '1951'], ['1950', '1950'], ['1950:0'], ['1950:x'], ['abc'], ['1:2:3']]) {
      expect(() => parseAllocations(bad)).toThrow();
    }
  });
});

const summary = {
  taskId: 5,
  estimate: { revisionNo: 2, source: 'human', seconds: 5400, tokens: 400000, costUsd: 2.7, credits: 2700 },
  actual: { wallSeconds: 9000, workSeconds: 6300, tokens: 512000, tokensNoCache: 150000, costUsd: 3.12, credits: 0, byokInferredCostUsd: 1.25, effortCount: 3, unknownTimeCount: 1, reworkWorkSeconds: 900 },
  deviation: { time: 1.167, token: 1.28, tokenNoCache: 0.375, costUsd: 1.156, credits: 0 },
  tokenBudget: { limit: 1000000, consumed: 512000, usageRatio: 0.512 },
  costVisible: true,
};

describe('pm task time', () => {
  it('GETs the summary and renders durations, ratios and cost', async () => {
    const r = await cli(['task', 'time', '5'], ok(summary));
    expect(r.http.get).toHaveBeenCalledWith('/progress/tasks/5/time-summary', { params: undefined });
    expect(r.stdout).toContain('1h30m');
    expect(r.stdout).toContain('1h45m');
    expect(r.stdout).toContain('116.7%');
    expect(r.stdout).toContain('$3.12');
    expect(r.stdout).toContain('时间未知');
  });
  it('hides cost when costVisible is false', async () => {
    const hidden = { ...summary, costVisible: false, estimate: { ...summary.estimate, costUsd: null, credits: null },
      actual: { ...summary.actual, costUsd: null, credits: null, byokInferredCostUsd: null }, deviation: { ...summary.deviation, costUsd: null, credits: null } };
    const r = await cli(['task', 'time', '5'], ok(hidden));
    expect(r.stdout).not.toContain('$');
    expect(r.stdout).not.toContain('Credits');
    expect(r.stdout).toContain('无成本权限');
  });
  it('shows a dash for a null deviation and prints raw JSON with --json', async () => {
    const noEst = { ...summary, estimate: null, deviation: { time: null, token: null, tokenNoCache: null, costUsd: null, credits: null } };
    const r = await cli(['task', 'time', '5'], ok(noEst));
    expect(r.stdout).toContain('估算: 无');
    expect(r.stdout).not.toContain('0%');
    const j = await cli(['task', 'time', '5', '--json'], ok(summary));
    expect(JSON.parse(j.stdout)).toEqual(summary);
  });
  it('rejects a bad id without HTTP and maps 2000', async () => {
    const bad = await cli(['task', 'time', 'abc']);
    expect(bad.exitCode).toBe(1);
    expect(noHttpCalls(bad)).toBe(true);
    const nf = await cli(['task', 'time', '9'], bizError(2000, '任务不存在'));
    expect(nf.exitCode).toBe(1);
    expect(nf.stderr).toContain('不存在，或你无权访问');
  });
});

describe('pm task estimate', () => {
  it('list renders revisions', async () => {
    const r = await cli(['task', 'estimate', 'list', '5'], ok({ costVisible: true, items: [{ revisionNo: 2, source: 'human', seconds: 5400, tokens: 400000, costUsd: 2.7, credits: 2700, reason: '重估', createdAt: 1761350400000 }] }));
    expect(r.http.get.mock.calls[0][0]).toBe('/progress/tasks/5/estimates');
    expect(r.stdout).toContain('#2');
    expect(r.stdout).toContain('1h30m');
    expect(r.stdout).toContain('重估');
  });
  it('set converts hours to integer seconds', async () => {
    const r = await cli(['task', 'estimate', 'set', '5', '--hours', '1.5', '--tokens', '500000', '--reason', '重估'], ok({ estimate: { revisionNo: 1, seconds: 5400 }, costVisible: true }));
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/5/estimates', { seconds: 5400, tokens: 500000, reason: '重估' });
  });
  it('set accepts seconds, source and model', async () => {
    const r = await cli(['task', 'estimate', 'set', '5', '--seconds', '7200', '--model', 'm1', '--source', 'ai', '--reason', 'x'], ok({ estimate: { revisionNo: 1 } }));
    expect(r.http.post.mock.calls[0][1]).toEqual({ seconds: 7200, modelCode: 'm1', source: 'ai', reason: 'x' });
  });
  it.each([
    [['--hours', '1', '--seconds', '60', '--reason', 'x']],
    [['--hours', '-1', '--reason', 'x']],
    [['--hours', 'abc', '--reason', 'x']],
    [['--seconds', '1.5', '--reason', 'x']],
    [['--reason', 'x']],
    [['--hours', '1']],
    [['--hours', '1', '--reason', '   ']],
    [['--hours', '1', '--reason', 'a'.repeat(501)]],
    [['--tokens', '10', '--input-tokens', '3', '--output-tokens', '3', '--reason', 'x']],
    [['--hours', '1', '--source', 'legacy_backfill', '--reason', 'x']],
    [['--hours', '1', '--source', 'fp_model', '--reason', 'x']],
  ])('set rejects invalid input %j before any HTTP call', async (args) => {
    const r = await cli(['task', 'estimate', 'set', '5', ...args]);
    expect(r.exitCode).toBeGreaterThan(0);
    expect(noHttpCalls(r)).toBe(true);
  });
  it('clear sends clear:true with the reason and requires it', async () => {
    const r = await cli(['task', 'estimate', 'clear', '5', '--reason', '取消'], ok({ estimate: null }));
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/5/estimates', { clear: true, reason: '取消' });
    const missing = await cli(['task', 'estimate', 'clear', '5']);
    expect(missing.exitCode).toBeGreaterThan(0);
    expect(noHttpCalls(missing)).toBe(true);
  });
  it('maps business code 1000/1001', async () => {
    const r = await cli(['task', 'estimate', 'set', '5', '--hours', '1', '--reason', 'x'], bizError(1001, 'bad'));
    expect(r.stderr).toContain('参数不合法');
  });
});

describe('pm task effort', () => {
  it('list passes paging and renders rows', async () => {
    const r = await cli(['task', 'effort', 'list', '5', '--size', '10', '--include-deleted'], ok({
      total: 1, page: 1, size: 10, costVisible: true,
      items: [{ id: 301, sourceType: 'manual', workSeconds: 3600, workBasis: 'manual', tokensTotal: 100, providerCostUsd: 1.5, sessionKey: 'manual:abc', isDeleted: true }],
    }));
    expect(r.http.get).toHaveBeenCalledWith('/progress/tasks/5/efforts', { params: { page: 1, size: 10, includeDeleted: true } });
    expect(r.stdout).toContain('301');
    expect(r.stdout).toContain('1h');
    expect(r.stdout).toContain('已作废');
  });
  it('list rejects size over 200', async () => {
    const r = await cli(['task', 'effort', 'list', '5', '--size', '500']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });
  const written = ok({ sessionKey: 'manual:s1', rows: [{ effortId: 1, taskId: 5, created: true, workSeconds: 5400, wallClockSeconds: 5400, tokensTotal: 0, allocationRatio: 1 }], costVisible: true });
  it('add single task sends taskId and integer seconds', async () => {
    const r = await cli(['task', 'effort', 'add', '--task', '5', '--work', '1h30m', '--session-id', 's1', '--note', '联调'], written);
    expect(r.http.post).toHaveBeenCalledWith('/progress/efforts', { sourceType: 'manual', sessionId: 's1', taskId: 5, workSeconds: 5400, note: '联调' });
    expect(r.stdout).toContain('manual:s1');
  });
  it('add multi-task sends allocations with weights and the full flag set', async () => {
    const r = await cli(['task', 'effort', 'add', '--task', '5:2', '--task', '6:1', '--work', '90m', '--source-type', 'hook_trace',
      '--input-tokens', '100', '--output-tokens', '20', '--cache-read-tokens', '5', '--cache-write-tokens', '1', '--model', 'm', '--byok',
      '--lines-added', '3', '--lines-deleted', '1', '--doc-chars', '9', '--pr', 'a/b#1', '--pr', 'a/b#2', '--rework',
      '--started-at', '1761350400000', '--ended-at', '1761357600000', '--executor-type', 'agent', '--agent', 'claude-code'], written);
    const body = r.http.post.mock.calls[0][1];
    expect(body).toMatchObject({
      sourceType: 'hook_trace', allocations: [{ taskId: 5, weight: 2 }, { taskId: 6, weight: 1 }], workSeconds: 5400,
      inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 1, modelCode: 'm', byok: true,
      linesAdded: 3, linesDeleted: 1, docChars: 9, prRefs: ['a/b#1', 'a/b#2'], isRework: true,
      startedAt: 1761350400000, endedAt: 1761357600000, executorType: 'AGENT', agentName: 'claude-code',
    });
    expect(body).not.toHaveProperty('taskId');
    expect(typeof body.sessionId).toBe('string');
    expect(body.sessionId.length).toBeGreaterThan(10);
  });
  it.each([
    [['--work', '1h']],
    [['--task', '5']],
    [['--task', '5', '--work', '90']],
    [['--task', '5:1', '--task', '6', '--work', '1h']],
    [['--task', '5', '--work', '1h', '--input-tokens', '-1']],
    [['--task', '5', '--work', '1h', '--source-type', 'execution_plan']],
    [['--task', '5', '--started-at', '1761357600000', '--ended-at', '1761350400000']],
    [['--task', '5', '--work', '1h', '--note', 'a'.repeat(501)]],
  ])('add rejects invalid input %j without HTTP', async (args) => {
    const r = await cli(['task', 'effort', 'add', ...args]);
    expect(r.exitCode).toBeGreaterThan(0);
    expect(noHttpCalls(r)).toBe(true);
  });
  it('add maps 1006 / 1007', async () => {
    expect((await cli(['task', 'effort', 'add', '--task', '5', '--work', '1h'], bizError(1006, 'x'))).stderr).toContain('已作废');
    expect((await cli(['task', 'effort', 'add', '--task', '5', '--work', '1h'], bizError(1007, 'x'))).stderr).toContain('reallocate');
  });
  it('void DELETEs with the URL-encoded reason', async () => {
    const r = await cli(['task', 'effort', 'void', '301', '--reason', '重复 上报'], ok({ effortId: 301, taskId: 5, voided: true }));
    expect(r.http.delete.mock.calls[0][0]).toBe(`/progress/efforts/301?reason=${encodeURIComponent('重复 上报')}`);
    expect(r.stdout).toContain('已作废');
    const missing = await cli(['task', 'effort', 'void', '301']);
    expect(missing.exitCode).toBeGreaterThan(0);
    expect(noHttpCalls(missing)).toBe(true);
  });
  it('reallocate encodes the session key and posts allocations', async () => {
    const r = await cli(['task', 'effort', 'reallocate', 'trace:abc#1', '--task', '5:1', '--task', '6:1', '--reason', '补报'], written);
    expect(r.http.post).toHaveBeenCalledWith('/progress/efforts/sessions/trace%3Aabc%231/reallocate', {
      allocations: [{ taskId: 5, weight: 1 }, { taskId: 6, weight: 1 }], reason: '补报',
    });
    const none = await cli(['task', 'effort', 'reallocate', 'k', '--reason', 'x']);
    expect(none.exitCode).toBeGreaterThan(0);
    expect(noHttpCalls(none)).toBe(true);
  });
});

describe('pm project time-deviation', () => {
  const data = { total: 1, page: 1, size: 50, costVisible: true, items: [{ taskId: 9, name: '任务A', status: 'completed', estimatedSeconds: 5400, actualWorkSeconds: 6300, timeDeviation: 1.167, tokenDeviation: null, costDeviationUsd: 1.156 }] };
  it('passes filters and renders the table', async () => {
    const r = await cli(['project', 'time-deviation', '12', '--executor-type', 'agent', '--completed-from', '2026-10-01', '--completed-to', '2026-10-25', '--only-completed'], ok(data));
    expect(r.http.get).toHaveBeenCalledWith('/progress/projects/12/time-deviation', {
      params: { page: 1, size: 50, executorType: 'AGENT', completedFrom: '2026-10-01', completedTo: '2026-10-25', onlyCompleted: true },
    });
    expect(r.stdout).toContain('116.7%');
    expect(r.stdout).toContain('任务A');
  });
  it('hides cost deviation when not visible; --json passes through', async () => {
    const r = await cli(['project', 'time-deviation', '12'], ok({ ...data, costVisible: false }));
    expect(r.stdout).not.toContain('成本偏差');
    expect(JSON.parse((await cli(['project', 'time-deviation', '12', '--json'], ok(data))).stdout)).toEqual(data);
  });
  it('rejects bad input', async () => {
    for (const args of [['abc'], ['12', '--completed-from', '2026-02-30'], ['12', '--executor-type', 'ROBOT']]) {
      const r = await cli(['project', 'time-deviation', ...args]);
      expect(r.exitCode).toBe(1);
      expect(noHttpCalls(r)).toBe(true);
    }
  });
});
