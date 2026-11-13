import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../../services/ApiClient';
import { noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { registerDecisionCommands } from '../index';
import { chunkEntries, parseJsonl, toItem } from '../upload';
import { runUpload } from '../uploadRun';

afterEach(() => vi.restoreAllMocks());

const B = '/api/v1/me/decisions';
const cli = (args: string[], res: any = ok(null)) => runCli(registerDecisionCommands, ['decision', ...args], res);
const TS = '2025-11-09T05:15:13.879Z';
const imp = (over: Record<string, unknown> = {}) => ({
  source_key: 'claude-implicit:sess-1:uuid-1', session: 'sess-1', ts: TS, situation_assistant: 'AI 当时说的话',
  reply: '就用方案二吧', question: '用哪个方案？', options: [{ label: '方案一', description: 'd1' }, { label: '方案二', description: '' }],
  choice: '方案二', choice_type: 'option', domain: 'architecture', confidence: 80, rationale: '更简单', source: 'implicit', ...over,
});
const structured = (n = 1) => ({
  id: `toolu_${n}:h`, session: 's', project: '-Users-alice-p', ts: TS, situation: { user_said: 'u', assistant_said: 'a' },
  question: `q${n}`, header: 'h', options: [{ label: 'A（推荐）' }, { label: 'B' }], choice: 'A（推荐）', custom: false, chose_recommended: true, note: '', source: 'structured',
});
const lines = (...rows: unknown[]) => rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)));
const fixture = (rows: string[]) => {
  const f = join(mkdtempSync(join(tmpdir(), 'decision-implicit-')), 'd.jsonl');
  writeFileSync(f, rows.join('\n'));
  return f;
};

describe('toItem implicit mapping', () => {
  it('maps every field per api-0189 1.1.0', () => {
    expect(toItem(imp())).toEqual({
      sourceKind: 'implicit', sourceKey: 'claude-implicit:sess-1:uuid-1', client: 'claude_code', sessionRef: 'sess-1',
      occurredAt: Date.parse(TS), question: '用哪个方案？', situationUser: '就用方案二吧', situationAssistant: 'AI 当时说的话',
      options: [{ label: '方案一', description: 'd1', recommended: false }, { label: '方案二', description: null, recommended: false }],
      choiceText: '方案二', choiceType: 'option', isRecommendedChosen: false, domain: 'architecture', confidence: 80, rationale: '更简单',
    });
  });
  it('sessionRef is the first 64 characters; local-only fields are never uploaded', () => {
    const it = toItem(imp({ session: 's'.repeat(80), project: '-Users-alice-p', id: 'x', situation: { user_said: 'x' } })) as unknown as Record<string, unknown>;
    expect(it.sessionRef).toBe('s'.repeat(64));
    for (const k of ['project', 'id', 'situation', 'source', 'source_key', 'reply']) expect(k in it).toBe(false);
  });
  it('empty or missing options are allowed with free_text; recommended is always false', () => {
    expect(toItem(imp({ options: [], choice_type: 'free_text' })).options).toEqual([]);
    const r: Record<string, unknown> = imp({ choice_type: 'free_text' });
    delete r.options;
    expect(toItem(r).options).toEqual([]);
  });
  it.each(['option', 'multi', 'custom', 'free_text'])('accepts choice_type %s', (t) => {
    expect(toItem(imp({ choice_type: t })).choiceType).toBe(t);
  });
  it('rationale / domain may be blank or absent', () => {
    const it = toItem(imp({ rationale: '  ', domain: undefined })) as any;
    expect(it.rationale).toBeNull();
    expect(it.domain).toBeNull();
    expect((toItem(imp({ rationale: undefined })) as any).rationale).toBeNull();
  });
  it.each([
    [{ ts: undefined }, 'ts'], [{ ts: 'nope' }, 'ts'], [{ ts: 12345 }, 'ts'],
    [{ choice_type: undefined }, 'choice_type'], [{ choice_type: 'x' }, 'choice_type'],
    [{ confidence: undefined }, 'confidence'], [{ confidence: 101 }, 'confidence'], [{ confidence: -1 }, 'confidence'],
    [{ confidence: 55.5 }, 'confidence'], [{ confidence: '80' }, 'confidence'], [{ confidence: null }, 'confidence'],
    [{ source_key: '' }, 'source_key'], [{ question: ' ' }, 'question'], [{ choice: undefined }, 'choice'],
    [{ options: 'x' }, 'options'], [{ options: [{ description: 'no label' }] }, 'options'],
  ])('rejects %j', (over, needle) => {
    expect(() => toItem(imp(over))).toThrow(needle);
  });
  it('confidence 0 and 100 are valid', () => {
    expect((toItem(imp({ confidence: 0 })) as any).confidence).toBe(0);
    expect((toItem(imp({ confidence: 100 })) as any).confidence).toBe(100);
  });
  it('redacts all text fields but not sourceKey', () => {
    const tok = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0' + 'k1L2m3N4';
    const it = toItem(imp({
      source_key: 'claude-implicit:s:password=x', reply: `my token ${tok}`, situation_assistant: 'see /Users/alice/x',
      question: 'key AKIAABCDEFGHIJKLMNOP?', options: [{ label: 'a /home/bob/y', description: 'sk-abcdefghijklmnopqrstuvwx' }],
      choice: 'Ab1' + 'x'.repeat(30), rationale: '-Users-alice-Documents-x', choice_type: 'custom',
    })) as any;
    expect(it.sourceKey).toBe('claude-implicit:s:password=x');
    expect(it.situationUser).toBe('my token [GITHUB_TOKEN]');
    expect(it.situationAssistant).toBe('see /Users/[USER]/x');
    expect(it.question).toBe('key [AWS_KEY]?');
    expect(it.options[0]).toMatchObject({ label: 'a /home/[USER]/y', description: '[API_KEY]' });
    expect(it.choiceText).toBe('[SECRET]');
    expect(it.rationale).toBe('-Users-[USER]-Documents-x');
  });
  it('missing source is structured; an unknown source is rejected', () => {
    const { source, ...noSource } = structured() as Record<string, unknown>;
    expect(toItem(noSource).sourceKind).toBe('structured');
    expect(() => toItem({ ...structured(2), source: 'platform_question' })).toThrow('source');
  });
  it('structured mapping is unchanged (no confidence / domain)', () => {
    const it = toItem(structured()) as unknown as Record<string, unknown>;
    expect('confidence' in it).toBe(false);
    expect('domain' in it).toBe(false);
  });
});

describe('mixed files', () => {
  it('parses both kinds from one file with file line numbers', () => {
    const p = parseJsonl(lines(structured(1), imp(), imp({ ts: undefined }), '{bad', structured(2)).join('\n'));
    expect(p.entries.map((e) => [e.line, e.item.sourceKind])).toEqual([[1, 'structured'], [2, 'implicit'], [5, 'structured']]);
    expect(p.bad.map((b) => b.line)).toEqual([3, 4]);
  });
  it('chunking works for implicit items', () => {
    const p = parseJsonl(lines(imp(), imp({ source_key: 'k2' })).join('\n'));
    expect(chunkEntries(p.entries, 'b').chunks).toHaveLength(1);
  });
});

describe('decision upload with implicit rows', () => {
  it('dry-run shows per-kind valid / bad counts and sends nothing', async () => {
    const f = fixture(lines(structured(1), imp(), imp({ source_key: 'k2' }), imp({ confidence: 999 }), { ...structured(3), question: '' }, '{bad'));
    const r = await cli(['upload', f, '--dry-run']);
    expect(noHttpCalls(r)).toBe(true);
    expect(r.stdout).toContain('有效 3 条，坏行 3');
    expect(r.stdout).toContain('点选：有效 1，坏行 1');
    expect(r.stdout).toContain('隐式：有效 2，坏行 1');
    expect(r.stdout).toContain('无法识别 1');
    expect(r.stdout).toContain('第 4 行');
  });
  it('--json summary carries per-kind counts', async () => {
    const r = await cli(['upload', fixture(lines(structured(1), imp(), imp({ ts: undefined }))), '--dry-run', '--json']);
    expect(JSON.parse(r.stdout).byKind).toEqual({ structured: { valid: 1, bad: 0 }, implicit: { valid: 1, bad: 1 }, unknown: { bad: 0 } });
  });
  it('POSTs both kinds in one request under one batchId', async () => {
    const f = fixture(lines(structured(1), imp()));
    const r = await cli(['upload', f], ok({ added: 2, skipped: 0, rejected: [] }));
    expect(r.http.post).toHaveBeenCalledTimes(1);
    const [url, body] = r.http.post.mock.calls[0];
    expect(url).toBe(`${B}/batch`);
    expect(body.items.map((i: any) => i.sourceKind)).toEqual(['structured', 'implicit']);
    expect(body.items[1]).toMatchObject({ sourceKey: 'claude-implicit:sess-1:uuid-1', confidence: 80, situationUser: '就用方案二吧' });
    expect(JSON.stringify(body)).not.toContain('Users');
  });
  it('a file with only bad implicit rows sends nothing', async () => {
    const r = await cli(['upload', fixture(lines(imp({ ts: undefined })))]);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });
  it('splits mixed rows into chunks sharing one batchId and stops on failure', async () => {
    const rows = lines(imp({ source_key: 'k1' }), structured(2), imp({ source_key: 'k3' }));
    const post = vi.spyOn(apiClient, 'post').mockResolvedValueOnce({ added: 1, skipped: 0, rejected: [] }).mockRejectedValueOnce(Object.assign(new Error('x'), { code: 1017 }));
    const s = await runUpload(fixture(rows), false, 800);
    const ids = post.mock.calls.map((c) => (c[1] as { batchId: string }).batchId);
    expect(new Set(ids).size).toBe(1);
    expect(s.chunks.map((c) => c.status)).toEqual(['sent', 'failed', 'unsent']);
    expect(s.byKind.implicit.valid).toBe(2);
  });
});

const dec = (over: Record<string, unknown> = {}) => ({
  id: 12, sourceKind: 'structured', question: '首发范围', choiceText: '草案', choiceType: 'option', isRecommendedChosen: true,
  domain: null, reviewStatus: 'unreviewed', occurredAt: 1762667713879, batchId: 'b-1', version: 4, confidence: null, ...over,
});

describe('decision list --max-confidence', () => {
  it('maps to maxConfidence and shows confidence (- for 点选)', async () => {
    const r = await cli(['list', '--max-confidence', '60'], ok({ total: 2, page: 1, pageSize: 20, items: [dec({ id: 1 }), dec({ id: 2, sourceKind: 'implicit', confidence: 55, choiceType: 'free_text', isRecommendedChosen: false })] }));
    expect(r.http.get).toHaveBeenCalledWith(B, { params: { maxConfidence: 60 } });
    expect(r.stdout).toContain('把握');
    expect(r.stdout).toContain('55');
    expect(r.stdout).toContain('自由文本');
    const row1 = r.stdout.split('\n').find((l: string) => /^\s*1\s/.test(l)) ?? '';
    expect(row1).toContain('-');
  });
  it('accepts 0 and 100', async () => {
    expect((await cli(['list', '--max-confidence', '0'], ok({ items: [] }))).http.get).toHaveBeenCalledWith(B, { params: { maxConfidence: 0 } });
    expect((await cli(['list', '--max-confidence', '100'], ok({ items: [] }))).http.get).toHaveBeenCalledWith(B, { params: { maxConfidence: 100 } });
  });
  it.each(['101', '-1', 'abc', '5.5', ''])('rejects %j locally without a request', async (v) => {
    const r = await cli(['list', '--max-confidence', v]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--max-confidence');
    expect(noHttpCalls(r)).toBe(true);
  });
  it('--json keeps confidence', async () => {
    const data = { total: 1, page: 1, pageSize: 20, items: [dec({ sourceKind: 'implicit', confidence: 70 })] };
    expect(JSON.parse((await cli(['list', '--json'], ok(data))).stdout).items[0].confidence).toBe(70);
  });
});

describe('decision get for implicit', () => {
  it('labels situationUser as 本人原回复 and shows confidence', async () => {
    const r = await cli(['get', '12'], ok(dec({ sourceKind: 'implicit', confidence: 72, situationUser: '就这样吧', options: [], choiceType: 'free_text', isRecommendedChosen: false })));
    expect(r.stdout).toContain('本人原回复：就这样吧');
    expect(r.stdout).not.toContain('用户原话');
    expect(r.stdout).toContain('把握度：72');
    expect(r.stdout).toContain('自由文本');
  });
  it('structured keeps the existing label and shows - for confidence', async () => {
    const r = await cli(['get', '12'], ok(dec({ situationUser: 'hi' })));
    expect(r.stdout).toContain('用户原话：hi');
    expect(r.stdout).toContain('把握度：—');
  });
});
