/** `good7ob req changes` (prd-0181 FP-6): request shapes, validation before any HTTP call, rendering. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerReqCommands } from '../index';
import { buildQuery, renderEvents, renderSummary } from '../changesLogic';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

afterEach(() => vi.restoreAllMocks());

const run = (args: string[], response = ok(null) as ReturnType<typeof ok>) => runCli(registerReqCommands, ['req', 'changes', ...args], response);
const bucket = (over = {}) => ({
  label: '2026-10-26 ~ 2026-11-01', inProgress: false, total: 7, deltaTotal: 2,
  totalsByAction: { add: 4, modify: 2, delete: 1 }, byOperator: { HUMAN: 3, AI: 3, SYSTEM: 0, UNKNOWN: 1 }, aiAssisted: 1, ...over,
});

describe('buildQuery', () => {
  const now = Date.UTC(2026, 10, 5, 3, 0, 0);

  it('defaults to a weekly summary in the given zone', () => {
    expect(buildQuery({}, 'Asia/Tokyo', now)).toEqual({ path: 'summary', params: { granularity: 'week', from: undefined, to: undefined, timezone: 'Asia/Tokyo', actorType: undefined, source: undefined } });
  });

  it('events default to the last 7 days of the viewer zone and normalise case', () => {
    const q = buildQuery({ events: true, layer: 'rp,fp', action: 'ADD', actorType: 'ai' }, 'Asia/Tokyo', now);
    expect(q.path).toBe('events');
    expect(q.params).toMatchObject({ from: '2026-10-30', to: '2026-11-05', layer: 'RP,FP', action: 'add', actorType: 'AI', page: 1, size: 20 });
  });

  it('refuses event-only flags on a summary, summary-only flags on events, and bad values', () => {
    expect(() => buildQuery({ layer: 'FE' }, 'UTC')).toThrow('--events');
    expect(() => buildQuery({ events: true, granularity: 'day' }, 'UTC')).toThrow('--granularity');
    expect(() => buildQuery({ granularity: 'year' }, 'UTC')).toThrow('--granularity');
    expect(() => buildQuery({ actorType: 'robot' }, 'UTC')).toThrow('--actor-type');
    expect(() => buildQuery({ from: '2026-11-05', to: '2026-11-01' }, 'UTC')).toThrow('不能晚于');
    expect(() => buildQuery({ events: true, size: '101' }, 'UTC')).toThrow('1-100');
    expect(() => buildQuery({ events: true, page: '0' }, 'UTC')).toThrow('--page');
  });
});

describe('render', () => {
  it('shows each bucket, the delta and the operator split, and says what "未区分" means', () => {
    const text = renderSummary({ granularity: 'week', timezone: 'Asia/Tokyo', recordStart: '2026-10-01T09:00:00+09:00', buckets: [bucket(), bucket({ inProgress: true, deltaTotal: null })] });
    expect(text).toContain('按周');
    expect(text).toContain('（进行中）');
    expect(text).toContain('+2');
    expect(text).toContain('—');
    expect(text).toContain('未区分');
    expect(text).toContain('记录起点');
  });

  it('says there is no record rather than printing zeros when the product has none', () => {
    expect(renderSummary({ granularity: 'day', timezone: 'UTC', recordStart: null, buckets: [] })).toContain('还没有任何需求变化记录');
  });

  it('marks AI employee and AI-assisted events', () => {
    const text = renderEvents({ total: 1, totalNodes: 1, page: 1, size: 20, items: [{ at: '2026-11-05T10:00:00+09:00', layer: 'RP', nodeCode: 'RP-1', nodeName: '超时', action: 'add', operatorType: 'AI', operatorName: '测试员小A', source: 'MANUAL', aiAssisted: false }] });
    expect(text).toContain('AI员工（测试员小A）');
    expect(text).toContain('新增');
  });
});

describe('req changes command', () => {
  it('calls the summary endpoint with the viewer zone', async () => {
    const r = await run(['--product', '10', '--granularity', 'month', '--actor-type', 'AI'], ok({ granularity: 'month', timezone: 'x', recordStart: null, buckets: [] }));
    expect(r.exitCode).toBeUndefined();
    const [url, cfg] = r.http.get.mock.calls[0];
    expect(url).toBe('/forge/products/10/requirement-changes/summary');
    expect(JSON.stringify(cfg)).toContain('"granularity":"month"');
    expect(JSON.stringify(cfg)).toContain('"actorType":"AI"');
  });

  it('calls the event list with --events and prints JSON untouched with --json', async () => {
    const payload = { total: 0, totalNodes: 0, page: 1, size: 20, items: [] };
    const r = await run(['--product', '10', '--events', '--json'], ok(payload));
    expect(r.http.get.mock.calls[0][0]).toBe('/forge/products/10/requirement-changes');
    expect(JSON.parse(r.stdout)).toEqual(payload);
  });

  it('refuses bad input before any HTTP call and explains a permission error', async () => {
    const bad = await run(['--product', '10', '--granularity', 'year']);
    expect(bad.exitCode).toBe(1);
    expect(noHttpCalls(bad)).toBe(true);
    const denied = await run(['--product', '10'], bizError(2000, 'x'));
    expect(denied.exitCode).toBe(1);
    expect(denied.stderr).toContain('无权访问');
  });
});
