/** prd-0126 FP-7 pure logic: scan, extraction, batching, rendering. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProgressRow, SyncResult, batchesOf, buildItems, extractRpCodes, inferKind, mergeResults, renderSyncSummary,
  repoFromRemote, ruleCell, scanDir, sha256Hex, stageCell,
} from '../logic';

describe('extractRpCodes', () => {
  it('finds distinct lower-case codes in first-seen order', () => {
    expect(extractRpCodes('见 RP-PM-Ledger-0001、rp-pm-ledger-0001 与 rp-a-b-c-12345。')).toEqual(['rp-pm-ledger-0001', 'rp-a-b-c-12345']);
  });
  it('ignores near misses', () => {
    expect(extractRpCodes('rp-a-1 too short, reprp-a-0001 glued, rp-a-0001x trailing, fun-a-0001 is an FP')).toEqual([]);
  });
  it('matches the same way as the backend parser for punctuation neighbours', () => {
    expect(extractRpCodes('(rp-a-0001), `rp-a-0002`; "rp-a-0003".')).toEqual(['rp-a-0001', 'rp-a-0002', 'rp-a-0003']);
  });
});

describe('inferKind', () => {
  it('reads arc- / db- / api- prefixes, anywhere in the tree', () => {
    expect(inferKind('docs/arc-0123-x.md')).toBe('ddd_arc');
    expect(inferKind('db-0118-资源进度跟踪.md')).toBe('ddd_db');
    expect(inferKind('a/b/API-0099-y.md')).toBe('ddd_api');
  });
  it('returns null for anything else', () => {
    expect(inferKind('README.md')).toBeNull();
    expect(inferKind('screens/home.html')).toBeNull();
  });
});

describe('sha256Hex', () => {
  it('is the lower-case hex digest', () => {
    expect(sha256Hex('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  });
});

describe('buildItems', () => {
  const file = (relPath: string, text: string) => ({ relPath, content: Buffer.from(text) });
  it('auto kind: infers from the name and reports files it cannot decide', () => {
    const r = buildItems([file('arc-1.md', 'rp-a-0001'), file('notes.md', 'x')], 'o/r', 'abc', 'auto');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ kind: 'ddd_arc', repoFullName: 'o/r', path: 'arc-1.md', commitSha: 'abc', rpCodes: ['rp-a-0001'] });
    expect(r.items[0].contentHash).toBe(sha256Hex('rp-a-0001'));
    expect(r.undecided).toEqual(['notes.md']);
  });
  it('a fixed kind applies to every file', () => {
    const r = buildItems([file('a.html', ''), file('b.html', '')], 'o/r', undefined, 'wireframe');
    expect(r.items.map((i) => i.kind)).toEqual(['wireframe', 'wireframe']);
    expect(r.undecided).toEqual([]);
  });
});

describe('batchesOf', () => {
  it('splits at the size', () => expect(batchesOf([1, 2, 3, 4, 5], 2).map((b) => b.length)).toEqual([2, 2, 1]));
});

describe('repoFromRemote', () => {
  it.each([
    ['git@github.com:good7ob/ddd.git', 'good7ob/ddd'],
    ['https://github.com/good7ob/ddd.git', 'good7ob/ddd'],
    ['https://github.com/good7ob/ddd', 'good7ob/ddd'],
    ['https://github.com/good7ob/ddd/', 'good7ob/ddd'],
  ])('%s', (url, expected) => expect(repoFromRemote(url)).toBe(expected));
  it('rejects other hosts', () => expect(repoFromRemote('git@gitlab.com:a/b.git')).toBeNull());
});

describe('mergeResults / renderSyncSummary', () => {
  const item = (over: object) => ({ repoFullName: 'o/r', path: 'a.md', action: 'created', linksAdded: 0, linksRemoved: 0, unknownCodes: [] as string[], ...over });
  const result = (over: Partial<SyncResult>): SyncResult => ({ dryRun: false, items: [], counts: {}, ...over });
  it('adds counts and keeps every item', () => {
    const m = mergeResults([result({ counts: { created: 2 }, items: [item({}), item({})] }), result({ counts: { created: 1, failed: 1 }, items: [item({})] })]);
    expect(m.counts).toEqual({ created: 3, failed: 1 });
    expect(m.items).toHaveLength(3);
  });
  it('is a dry run only when every batch was', () => {
    expect(mergeResults([result({ dryRun: true }), result({ dryRun: true })]).dryRun).toBe(true);
    expect(mergeResults([result({ dryRun: true }), result({ dryRun: false })]).dryRun).toBe(false);
  });
  it('summarises counts, links, unknown codes and failures', () => {
    const text = renderSyncSummary(result({
      counts: { created: 1, failed: 1 },
      items: [item({ linksAdded: 2, unknownCodes: ['rp-zzz-9999'] }), item({ path: 'bad.md', action: 'failed', message: '哈希不合法' })],
    }));
    expect(text).toContain('新增 1');
    expect(text).toContain('失败 1');
    expect(text).toContain('RP 关联：新增 2，移除 0');
    expect(text).toContain('rp-zzz-9999');
    expect(text).toContain('✗ bad.md: 哈希不合法');
  });
  it('marks a dry run', () => expect(renderSyncSummary(result({ dryRun: true }))).toContain('dry-run，未写入'));
});

describe('stage cells', () => {
  const row = (stages: ProgressRow['stages']): ProgressRow => ({ level: 'prd', key: 'prd-1', ruleCount: stages ? 3 : 0, stages });
  it('shows done/total and flags stale ones', () => {
    expect(stageCell(row({ design: { done: 1, total: 3, stale: 2 } }), 'design')).toBe('1/3 ⚠2');
    expect(stageCell(row({ design: { done: 3, total: 3, stale: 0 } }), 'design')).toBe('3/3');
  });
  it('a row without rule points shows a dash, never 0', () => expect(stageCell(row(null), 'design')).toBe('—'));
  it('rule cells use marks and flag stale', () => {
    const rule = { code: 'rp-a-0001', stages: { design: { status: 'IN_PROGRESS', stale: true }, testResult: { status: 'NO_RESULT', stale: false } } };
    expect(ruleCell(rule, 'design')).toBe('◐ ⚠');
    expect(ruleCell(rule, 'testResult')).toBe('无结果');
    expect(ruleCell(rule, 'code')).toBe('—');
  });
});

describe('scanDir', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-scan-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (rel: string, text = 'x') => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  it('walks recursively with posix relative paths in a stable order and filters by extension', () => {
    write('b/arc-2.md'); write('a.md'); write('c.png'); write('b/deep/x.html');
    expect(scanDir(dir).map((f) => f.relPath)).toEqual(['a.md', 'b/arc-2.md', 'b/deep/x.html']);
    expect(scanDir(dir, ['.html']).map((f) => f.relPath)).toEqual(['b/deep/x.html']);
  });
  it('skips .git, node_modules and hidden directories', () => {
    write('.git/x.md'); write('node_modules/y.md'); write('.hidden/z.md'); write('ok.md');
    expect(scanDir(dir).map((f) => f.relPath)).toEqual(['ok.md']);
  });
});
