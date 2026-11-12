import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../../services/ApiClient';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { registerDecisionCommands } from '../index';
import { runUpload } from '../uploadRun';

afterEach(() => vi.restoreAllMocks());

const B = '/api/v1/me/decisions';
const cli = (args: string[], res: any = ok(null)) => runCli(registerDecisionCommands, ['decision', ...args], res);
const dec = (over: Record<string, unknown> = {}) => ({
  id: 12, sourceKind: 'structured', question: '首发范围按哪个起草？', choiceText: '我的草案（推荐）', choiceType: 'option',
  isRecommendedChosen: true, domain: null, reviewStatus: 'unreviewed', occurredAt: 1762667713879, batchId: 'b-1', version: 4,
  options: [{ label: 'A（推荐）', description: 'x', recommended: true }], rationale: null, ...over,
});
const row = (n: number, over: Record<string, unknown> = {}) => JSON.stringify({
  id: `toolu_${n}:h`, session: 's', project: '-Users-alice-p', ts: '2025-11-09T05:15:13.879Z', situation: { user_said: 'u', assistant_said: 'a' },
  question: `q${n}`, header: 'h', options: [{ label: 'A（推荐）', description: '' }, { label: 'B', description: '' }], choice: 'A（推荐）',
  custom: false, chose_recommended: true, note: '', source: 'structured', ...over,
});
const fixture = (lines: string[]) => {
  const f = join(mkdtempSync(join(tmpdir(), 'decision-test-')), 'd.jsonl');
  writeFileSync(f, lines.join('\n'));
  return f;
};
async function rejects(args: string[], needle: string) {
  const r = await cli(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('decision upload', () => {
  it('POSTs one request with a mapped body and prints the summary', async () => {
    const f = fixture([row(1), row(2)]);
    const r = await cli(['upload', f], ok({ batchId: 'x', added: 2, skipped: 0, rejected: [] }));
    expect(r.http.post).toHaveBeenCalledTimes(1);
    const [url, body, cfg] = r.http.post.mock.calls[0];
    expect(url).toBe(`${B}/batch`);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].sourceKey).toBe('claude:toolu_1:h');
    expect(JSON.stringify(body)).not.toContain('Users');
    expect(body.batchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(cfg.timeout).toBeGreaterThan(30_000);
    expect(r.stdout).toContain('新增 2，跳过 0，服务端拒绝 0');
    expect(r.stdout).toContain(body.batchId);
  });
  it('--dry-run sends nothing and reports counts, bad lines and chunks', async () => {
    const f = fixture([row(1), '{bad', row(2, { question: '' }), row(3)]);
    const r = await cli(['upload', f, '--dry-run']);
    expect(noHttpCalls(r)).toBe(true);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('dry-run');
    expect(r.stdout).toContain('有效 2 条，坏行 2');
    expect(r.stdout).toContain('第 2 行：不是合法 JSON');
    expect(r.stdout).toContain('第 3 行');
    expect(r.stdout).toContain('分 1 块');
  });
  it('--json prints the summary object', async () => {
    const r = await cli(['upload', fixture([row(1)]), '--dry-run', '--json']);
    const s = JSON.parse(r.stdout);
    expect(s).toMatchObject({ dryRun: true, validRows: 1, badLines: [] });
  });
  it('unreadable file is an input error', () => rejects(['upload', '/nonexistent/x.jsonl'], '无法读取'));
  it('no valid rows is an error and sends nothing', async () => {
    const r = await cli(['upload', fixture(['{bad'])]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('没有可上传的有效记录');
    expect(noHttpCalls(r)).toBe(true);
  });
  it('server rejection indices map back to file lines', async () => {
    const f = fixture([row(1), '{bad', row(3)]);
    const r = await cli(['upload', f], ok({ added: 1, skipped: 0, rejected: [{ index: 1, sourceKey: 'k', code: 1001, field: 'options', message: '至少 2 个' }] }));
    expect(r.stdout).toContain('第 3 行 options：至少 2 个 [1001]');
  });
  it('a failing request reports the error, exits 1, still prints what happened', async () => {
    const r = await cli(['upload', fixture([row(1)])], bizError(1017, '太大'));
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('失败');
    expect(r.stderr).toContain('单次上传数据量超限');
    expect(r.http.post).toHaveBeenCalledTimes(1);
  });
});

describe('runUpload with several chunks', () => {
  it('shares one batchId, sums results, converts rejected index to file line', async () => {
    const f = fixture([row(1), row(2), row(3), row(4)]);
    const post = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ added: 2, skipped: 0, rejected: [] })
      .mockResolvedValueOnce({ added: 0, skipped: 1, rejected: [{ index: 1, code: 1001, field: 'question', message: 'm' }] });
    const s = await runUpload(f, false, 1100);
    expect(post).toHaveBeenCalledTimes(2);
    const ids = post.mock.calls.map((c) => (c[1] as { batchId: string }).batchId);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(s.batchId);
    expect(s).toMatchObject({ added: 2, skipped: 1, chunks: [{ status: 'sent' }, { status: 'sent' }] });
    expect(s.rejected).toEqual([expect.objectContaining({ line: 4, field: 'question' })]);
  });
  it('stops at the first failed chunk: no retry, later chunks unsent, earlier results kept', async () => {
    const f = fixture([row(1), row(2), row(3)]);
    const err = Object.assign(new Error('网络'), { code: 1017 });
    const post = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({ added: 1, skipped: 0, rejected: [] }).mockRejectedValueOnce(err);
    const s = await runUpload(f, false, 800);
    expect(post).toHaveBeenCalledTimes(2);
    expect(s.chunks.map((c) => c.status)).toEqual(['sent', 'failed', 'unsent']);
    expect(s.added).toBe(1);
    expect(s.failure).toBe(err);
    expect(s.chunks[1].error).toContain('1017');
  });
  it('oversized single rows are rejected locally, not sent', async () => {
    const f = fixture([row(1), row(2, { question: 'q'.repeat(3000) }), row(3)]);
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ added: 2, skipped: 0, rejected: [] });
    const s = await runUpload(f, false, 1500);
    expect(s.oversized.map((o) => o.line)).toEqual([2]);
    const sent = post.mock.calls.flatMap((c) => (c[1] as { items: { question: string }[] }).items.map((i) => i.question));
    expect(sent).toEqual(['q1', 'q3']);
  });
  it('dry run plans chunks without calling the API', async () => {
    const post = vi.spyOn(apiClient, 'post');
    const s = await runUpload(fixture([row(1), row(2), row(3)]), true, 800);
    expect(post).not.toHaveBeenCalled();
    expect(s.chunks.length).toBeGreaterThan(1);
    expect(s.chunks.every((c) => c.status === 'planned')).toBe(true);
  });
});

describe('decision list', () => {
  it('GETs with normalised params and renders a table', async () => {
    const r = await cli(['list', '--source', 'STRUCTURED', '--review', 'excluded', '--domain', 'none', '--from', '2026-11-01', '--to', '2026-11-13', '--page', '2', '--page-size', '50'],
      ok({ total: 1, page: 2, pageSize: 50, items: [dec()] }));
    expect(r.http.get).toHaveBeenCalledWith(B, { params: {
      source: 'structured', reviewStatus: 'excluded', domain: 'none',
      from: Date.parse('2026-11-01T00:00:00+09:00'), to: Date.parse('2026-11-13T00:00:00+09:00'), page: 2, pageSize: 50,
    } });
    expect(r.stdout).toContain('首发范围按哪个起草');
    expect(r.stdout).toContain('共 1 条，第 2 页');
  });
  it('accepts epoch ms for --from; sends no params by default', async () => {
    const r = await cli(['list', '--from', '1762667713879'], ok({ total: 0, items: [] }));
    expect(r.http.get).toHaveBeenCalledWith(B, { params: { from: 1762667713879 } });
    expect(r.stdout).toContain('没有决策记录');
  });
  it('--json prints raw data', async () => {
    const data = { total: 1, page: 1, pageSize: 20, items: [dec()] };
    expect(JSON.parse((await cli(['list', '--json'], ok(data))).stdout)).toEqual(data);
  });
  it.each([
    [['--source', 'x'], '--source'], [['--review', 'x'], '--review'], [['--domain', 'x'], '--domain'],
    [['--from', 'yesterday'], '--from'], [['--page-size', '101'], '--page-size'], [['--page', '0'], '--page'],
    [['--from', '2026-11-13', '--to', '2026-11-01'], '--from'],
  ])('rejects %j', (args, needle) => rejects(['list', ...args], needle));
});

describe('decision get', () => {
  it('GETs by id and shows detail', async () => {
    const r = await cli(['get', '12'], ok(dec({ rationale: '因为简单', situationUser: 'hi' })));
    expect(r.http.get).toHaveBeenCalledWith(`${B}/12`, { params: undefined });
    expect(r.stdout).toContain('因为简单');
    expect(r.stdout).toContain('版本 4');
    expect(r.stdout).toContain('A（推荐）');
  });
  it('rejects a bad id', () => rejects(['get', 'abc'], 'id'));
  it('maps 1002', async () => {
    const r = await cli(['get', '9'], bizError(1002));
    expect(r.stderr).toContain('决策不存在或不属于你');
  });
});

describe('decision update', () => {
  const responder = (m: string) => (m === 'get' ? ok(dec({ version: 7 })) : ok(dec({ reviewStatus: 'corrected', version: 8 })));
  it('GETs the version first, then PUTs only the given fields', async () => {
    const r = await runCli(registerDecisionCommands, ['decision', 'update', '12', '--rationale', '理由', '--domain', 'Deploy_Release'], responder);
    expect(r.http.get).toHaveBeenCalledWith(`${B}/12`, { params: undefined });
    expect(r.http.put).toHaveBeenCalledWith(`${B}/12`, { rationale: '理由', domain: 'deploy_release', version: 7 });
    expect(r.stdout).toContain('已修正');
  });
  it('--domain "" clears the domain and leaves rationale out', async () => {
    const r = await runCli(registerDecisionCommands, ['decision', 'update', '12', '--domain', ''], responder);
    expect(r.http.put).toHaveBeenCalledWith(`${B}/12`, { domain: '', version: 7 });
  });
  it.each([
    [['12'], '至少给出'], [['12', '--domain', 'x'], '--domain'], [['12', '--rationale', '字'.repeat(2001)], '最多 2000'],
  ])('rejects %j before any request', (args, needle) => rejects(['update', ...args], needle));
  it('version conflict is reported', async () => {
    const r = await runCli(registerDecisionCommands, ['decision', 'update', '12', '--rationale', 'x'], (m) => (m === 'get' ? ok(dec()) : bizError(1009)));
    expect(r.stderr).toContain('版本冲突');
  });
});

describe.each([['confirm', '确认', 'confirmed'], ['exclude', '排除', 'excluded'], ['restore', '撤回排除', 'unreviewed']])('decision %s', (action, verb, status) => {
  it('GETs the version then POSTs the review action', async () => {
    const r = await runCli(registerDecisionCommands, ['decision', action, '12'], (m) => (m === 'get' ? ok(dec({ version: 5 })) : ok(dec({ reviewStatus: status, version: 6 }))));
    expect(r.http.post).toHaveBeenCalledWith(`${B}/12/review`, { action, version: 5 });
    expect(r.stdout).toContain(`已${verb}决策 #12`);
  });
  it('maps 1007', async () => {
    const r = await runCli(registerDecisionCommands, ['decision', action, '12'], (m) => (m === 'get' ? ok(dec()) : bizError(1007)));
    expect(r.stderr).toContain('当前状态不支持该操作');
  });
});

describe('decision delete', () => {
  it('ids -> { ids } (deduplicated)', async () => {
    const r = await cli(['delete', '12', '13', '12'], ok({ deleted: 2 }));
    expect(r.http.post).toHaveBeenCalledWith(`${B}/delete`, { ids: [12, 13] });
    expect(r.stdout).toContain('已删除 2 条');
  });
  it('--batch -> { batchId }', async () => {
    const r = await cli(['delete', '--batch', 'b-1'], ok({ deleted: 5 }));
    expect(r.http.post).toHaveBeenCalledWith(`${B}/delete`, { batchId: 'b-1' });
  });
  it.each([
    [[], '请给出'], [['1', '--batch', 'b'], '二选一'], [['x'], 'id'], [['--batch', 'x'.repeat(37)], '--batch'],
    [Array.from({ length: 501 }, (_, i) => String(i + 1)), '最多 500'],
  ])('rejects %j', (args, needle) => rejects(['delete', ...args], needle));
});

describe('decision purge', () => {
  it('refuses without --yes, explains, sends nothing', async () => {
    const r = await cli(['purge', '12']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('不可恢复');
    expect(r.stderr).toContain('--yes');
    expect(noHttpCalls(r)).toBe(true);
    await rejects(['purge', '--batch', 'b-1'], '--yes');
  });
  it('--yes with ids / batch POSTs purge', async () => {
    const a = await cli(['purge', '12', '--yes'], ok({ purged: 1 }));
    expect(a.http.post).toHaveBeenCalledWith(`${B}/purge`, { ids: [12] });
    expect(a.stdout).toContain('已永久删除 1 条');
    const b = await cli(['purge', '--batch', 'b-1', '--yes'], ok({ purged: 9 }));
    expect(b.http.post).toHaveBeenCalledWith(`${B}/purge`, { batchId: 'b-1' });
  });
  it('still validates targets before the --yes check', () => rejects(['purge', '--yes'], '请给出'));
});
