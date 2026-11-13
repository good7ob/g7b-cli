import { describe, expect, it } from 'vitest';
import { chunkEntries, parseJsonl, toItem } from '../upload';

const raw = (over: Record<string, unknown> = {}) => ({
  id: 'toolu_01ABC:首发范围', session: 'sess-1', project: '-Users-alice-Documents-work-x', ts: '2025-11-09T05:15:13.879Z',
  situation: { user_said: 'u says', assistant_said: 'a says' }, question: '按哪个起草？', header: '首发范围',
  options: [{ label: '我的草案（推荐）', description: 'd1' }, { label: 'B (Recommended)', description: '' }, { label: 'C', description: 'd3' }],
  choice: '我的草案（推荐）', custom: false, multi: false, chose_recommended: true, note: '', source: 'structured', ...over,
});

describe('toItem field mapping', () => {
  it('maps every field per api-0189 §1', () => {
    const it = toItem(raw());
    expect(it).toEqual({
      sourceKind: 'structured', sourceKey: 'claude:toolu_01ABC:首发范围', client: 'claude_code', sessionRef: 'sess-1',
      occurredAt: Date.parse('2025-11-09T05:15:13.879Z'), question: '按哪个起草？',
      situationUser: 'u says', situationAssistant: 'a says',
      options: [
        { label: '我的草案（推荐）', description: 'd1', recommended: true },
        { label: 'B (Recommended)', description: null, recommended: true },
        { label: 'C', description: 'd3', recommended: false },
      ],
      choiceText: '我的草案（推荐）', choiceType: 'option', isRecommendedChosen: true, rationale: null,
    });
  });
  it('never carries project, productId, taskId or the raw header', () => {
    const it = toItem(raw()) as unknown as Record<string, unknown>;
    expect(JSON.stringify(it)).not.toContain('Users');
    for (const k of ['project', 'productId', 'taskId', 'header']) expect(k in it).toBe(false);
  });
  it('occurredAt is epoch ms from the UTC ISO string', () => {
    expect(toItem(raw({ ts: '1970-01-01T00:00:01.000Z' })).occurredAt).toBe(1000);
  });
  it.each([
    [{ multi: true, custom: true }, 'multi'],
    [{ multi: true }, 'multi'],
    [{ custom: true }, 'custom'],
    [{}, 'option'],
    [{ multi: undefined }, 'option'],
  ])('choiceType from %j is %s', (over, type) => {
    expect(toItem(raw(over)).choiceType).toBe(type);
  });
  it('multi flag may be absent entirely', () => {
    const r: Record<string, unknown> = raw();
    delete r.multi;
    expect(toItem(r).choiceType).toBe('option');
  });
  it('custom choice is never marked recommended-chosen (server rule)', () => {
    expect(toItem(raw({ custom: true, chose_recommended: true })).isRecommendedChosen).toBe(false);
  });
  it('note becomes rationale; blank note becomes null', () => {
    expect(toItem(raw({ note: '  因为简单  ' })).rationale).toBe('因为简单');
    expect(toItem(raw({ note: '   ' })).rationale).toBeNull();
    expect(toItem(raw({ note: undefined })).rationale).toBeNull();
  });
  it('missing situation / session become null', () => {
    const it = toItem(raw({ situation: undefined, session: undefined }));
    expect([it.situationUser, it.situationAssistant, it.sessionRef]).toEqual([null, null, null]);
  });
  it('redacts every text field client-side', () => {
    const it = toItem(raw({
      situation: { user_said: 'password=hunter2', assistant_said: 'see /Users/alice/x' },
      question: 'key AKIAABCDEFGHIJKLMNOP?', options: [{ label: 'a /home/bob/y', description: 'sk-abcdefghijklmnopqrstuvwx' }, { label: 'b' }],
      choice: 'token: abc', note: '-Users-alice-Documents-x',
    }));
    expect(it.situationUser).toBe('password=[REDACTED]');
    expect(it.situationAssistant).toBe('see /Users/[USER]/x');
    expect(it.question).toBe('key [AWS_KEY]?');
    expect(it.options[0]).toMatchObject({ label: 'a /home/[USER]/y', description: '[API_KEY]' });
    expect(it.choiceText).toBe('token: [REDACTED]');
    expect(it.rationale).toBe('-Users-[USER]-Documents-x');
  });
  it('keeps sourceKey unredacted (idempotency key)', () => {
    expect(toItem(raw({ id: 'toolu_1:password=x' })).sourceKey).toBe('claude:toolu_1:password=x');
  });
  it.each([
    [{ id: '' }, 'id'], [{ question: ' ' }, 'question'], [{ choice: undefined }, 'choice'],
    [{ ts: 'not a date' }, 'ts'], [{ ts: undefined }, 'ts'], [{ options: 'x' }, 'options'], [{ options: [{ description: 'no label' }] }, 'options'],
  ])('rejects %j', (over, needle) => {
    expect(() => toItem(raw(over))).toThrow(needle);
  });
  it('rejects non-objects', () => {
    expect(() => toItem([1])).toThrow('JSON 对象');
    expect(() => toItem(null)).toThrow('JSON 对象');
  });
});

describe('parseJsonl', () => {
  it('skips bad lines, reports 1-based line numbers, ignores blank lines', () => {
    const content = [
      JSON.stringify(raw()), '{not json', '', JSON.stringify(raw({ question: '' })), JSON.stringify(raw({ id: 'toolu_2:x' })), '',
    ].join('\n');
    const p = parseJsonl(content);
    expect(p.entries.map((e) => e.line)).toEqual([1, 5]);
    expect(p.bad).toEqual([
      { line: 2, reason: '不是合法 JSON' },
      { line: 4, reason: expect.stringContaining('question') },
    ]);
  });
  it('handles CRLF and empty input', () => {
    expect(parseJsonl(`${JSON.stringify(raw())}\r\n`).entries).toHaveLength(1);
    expect(parseJsonl('')).toEqual({ entries: [], bad: [] });
  });
});

describe('chunkEntries', () => {
  const entry = (line: number, pad = 0) => ({ line, item: toItem(raw({ id: `t:${line}`, question: 'q'.repeat(10 + pad) })) });
  const bodyBytes = (batchId: string, es: { item: unknown }[]) => Buffer.byteLength(JSON.stringify({ batchId, items: es.map((e) => e.item) }), 'utf8');
  const B = 'batch-1';

  it('one chunk when everything fits; bytes equal the real body size', () => {
    const es = [entry(1), entry(2), entry(3)];
    const { chunks, oversized } = chunkEntries(es, B);
    expect(chunks).toHaveLength(1);
    expect(oversized).toEqual([]);
    expect(chunks[0].bytes).toBe(bodyBytes(B, es));
  });
  it('limit exactly equal to the body size still fits in one chunk', () => {
    const es = [entry(1), entry(2)];
    expect(chunkEntries(es, B, bodyBytes(B, es)).chunks).toHaveLength(1);
  });
  it('one byte over splits it into two chunks, each within the limit', () => {
    const es = [entry(1), entry(2)];
    const limit = bodyBytes(B, es) - 1;
    const { chunks } = chunkEntries(es, B, limit);
    expect(chunks.map((c) => c.entries.map((e) => e.line))).toEqual([[1], [2]]);
    for (const c of chunks) expect(bodyBytes(B, c.entries)).toBeLessThanOrEqual(limit);
  });
  it('counts UTF-8 bytes, not characters', () => {
    const cn = { line: 1, item: toItem(raw({ question: '字'.repeat(100) })) };
    const ascii = { line: 2, item: toItem(raw({ question: 'a'.repeat(100) })) };
    expect(chunkEntries([cn], B).chunks[0].bytes).toBe(bodyBytes(B, [cn]));
    expect(chunkEntries([cn], B).chunks[0].bytes).toBeGreaterThan(chunkEntries([ascii], B).chunks[0].bytes + 150);
  });
  it('an item that alone exceeds the limit is rejected locally; the rest still chunk', () => {
    const big = entry(2, 5000);
    const small = [entry(1), entry(3)];
    const limit = bodyBytes(B, small) + 100;
    const { chunks, oversized } = chunkEntries([small[0], big, small[1]], B, limit);
    expect(oversized.map((o) => o.line)).toEqual([2]);
    expect(oversized[0].bytes).toBeGreaterThan(limit);
    expect(chunks.flatMap((c) => c.entries.map((e) => e.line))).toEqual([1, 3]);
  });
  it('an item exactly at the limit is accepted, one byte more is oversized', () => {
    const e = entry(1);
    const exact = bodyBytes(B, [e]);
    expect(chunkEntries([e], B, exact).chunks).toHaveLength(1);
    expect(chunkEntries([e], B, exact - 1).oversized).toHaveLength(1);
  });
  it('no entries -> no chunks', () => {
    expect(chunkEntries([], B)).toEqual({ chunks: [], oversized: [] });
  });
});
