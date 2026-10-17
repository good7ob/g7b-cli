/** prd-0126 FP-7 commands. git is mocked at ./git; HTTP via the shared harness; files are real, in a temp dir. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerArtifactCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

vi.mock('../git', () => ({ remoteUrl: vi.fn(() => 'git@github.com:good7ob/ddd.git'), headSha: vi.fn(() => 'abc1234') }));

const syncOk = (counts: Record<string, number>, items: unknown[] = []) => ({ dryRun: false, items, counts });
const withRules = (n: number) => ({ level: 'prd', rows: [{ level: 'prd', key: 'prd-0123', ruleCount: n, stages: n ? {} : null }] });

describe('artifact commands', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-cmd-')); });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });
  const write = (rel: string, text = 'x') => fs.writeFileSync(path.join(dir, rel), text);
  const writeMany = (n: number) => { for (let i = 0; i < n; i++) write(`arc-${String(i).padStart(4, '0')}.md`, `rp-a-${String(i).padStart(4, '0')}`); };
  const posts = (r: Awaited<ReturnType<typeof runCli>>) => r.http.post.mock.calls.filter((c) => String(c[0]).endsWith('/artifacts/sync'));
  const server = (rules: number, sync: (body: any) => unknown = () => ok(syncOk({ created: 1 }))) => (m: string, url: string) => {
    if (url.endsWith('/progress')) return ok(withRules(rules));
    if (url.endsWith('/artifacts/sync')) return sync(null) as never;
    return bizError(404, url);
  };

  it('sync uploads hash, repo, commit and the RP codes found in the body', async () => {
    write('arc-0123-x.md', '覆盖 rp-pm-ledger-0001 与 rp-pm-ledger-0002');
    const r = await runCli(registerArtifactCommands, ['artifact', 'sync', '--product', '10', '--dir', dir], server(5));

    expect(r.exitCode).toBeUndefined();
    const [call] = posts(r);
    expect(call[0]).toBe('/artifact-progress/products/10/artifacts/sync');
    const body = call[1] as { items: any[]; fullScan: boolean; dryRun: boolean };
    expect(body.fullScan).toBe(false);
    expect(body.dryRun).toBe(false);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ kind: 'ddd_arc', repoFullName: 'good7ob/ddd', path: 'arc-0123-x.md', commitSha: 'abc1234', rpCodes: ['rp-pm-ledger-0001', 'rp-pm-ledger-0002'] });
    expect(body.items[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.stdout).toContain('同步完成');
  });

  it('refuses before reading any file when the product has no rule points (rp-pm-artifact-0044)', async () => {
    write('arc-1.md');
    const r = await runCli(registerArtifactCommands, ['artifact', 'sync', '--product', '10', '--dir', dir], server(0));

    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('import-structure');
    expect(posts(r)).toHaveLength(0);
  });

  it('--dry-run is passed through (rp-pm-artifact-0043)', async () => {
    write('arc-1.md');
    const r = await runCli(registerArtifactCommands, ['artifact', 'sync', '--product', '10', '--dir', dir, '--dry-run'],
      server(5, () => ok({ dryRun: true, items: [], counts: { created: 1 } })));

    expect((posts(r)[0][1] as { dryRun: boolean }).dryRun).toBe(true);
    expect(r.stdout).toContain('dry-run，未写入');
  });

  it('splits an ordinary sync into batches of 200', async () => {
    writeMany(450);
    const r = await runCli(registerArtifactCommands, ['artifact', 'sync', '--product', '10', '--dir', dir], server(5));

    expect(posts(r).map((c) => (c[1] as { items: unknown[] }).items.length)).toEqual([200, 200, 50]);
    expect(r.stdout).toContain('新增 3');
  });

  it('--full-scan goes in one call and is refused above the limit', async () => {
    writeMany(300);
    const one = await runCli(registerArtifactCommands, ['artifact', 'sync', '--product', '10', '--dir', dir, '--full-scan'], server(5));
    expect(posts(one)).toHaveLength(1);
    expect((posts(one)[0][1] as { fullScan: boolean; items: unknown[] }).fullScan).toBe(true);
    expect((posts(one)[0][1] as { items: unknown[] }).items).toHaveLength(300);

    writeMany(1001);
    const many = await runCli(registerArtifactCommands, ['artifact', 'sync', '--product', '10', '--dir', dir, '--full-scan'], server(5));
    expect(many.exitCode).toBe(1);
    expect(many.stderr).toContain('1000');
    expect(posts(many)).toHaveLength(0);
  });

  it('files whose kind cannot be decided are skipped and named', async () => {
    write('arc-1.md'); write('notes.md');
    const r = await runCli(registerArtifactCommands, ['artifact', 'sync', '--product', '10', '--dir', dir], server(5));

    expect((posts(r)[0][1] as { items: unknown[] }).items).toHaveLength(1);
    expect(r.stdout).toContain('notes.md');
  });

  it('a failed item makes the command exit non-zero but still prints the summary', async () => {
    write('arc-1.md');
    const r = await runCli(registerArtifactCommands, ['artifact', 'sync', '--product', '10', '--dir', dir],
      server(5, () => ok(syncOk({ failed: 1 }, [{ repoFullName: 'o/r', path: 'arc-1.md', action: 'failed', message: '哈希不合法', linksAdded: 0, linksRemoved: 0, unknownCodes: [] }]))));

    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('哈希不合法');
  });

  it('a business error from the server is shown readably and exits non-zero', async () => {
    write('arc-1.md');
    const r = await runCli(registerArtifactCommands, ['artifact', 'sync', '--product', '10', '--dir', dir],
      (m, url) => (url.endsWith('/progress') ? bizError(1002, '产品不存在') : bizError(404, url)));

    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('产品不存在');
  });

  it('bad input never reaches the network', async () => {
    const noProduct = await runCli(registerArtifactCommands, ['artifact', 'sync', '--dir', dir]);
    expect(noProduct.exitCode).toBe(1);
    expect(noHttpCalls(noProduct)).toBe(true);
    const badKind = await runCli(registerArtifactCommands, ['artifact', 'sync', '--product', '10', '--kind', 'code']);
    expect(badKind.exitCode).toBe(1);
    expect(noHttpCalls(badKind)).toBe(true);
  });

  it('status prints PRD rows with done/total, stale marks and a dash for empty PRDs', async () => {
    const r = await runCli(registerArtifactCommands, ['artifact', 'status', '--product', '10'], ok({
      level: 'prd',
      rows: [
        { level: 'prd', key: 'prd-0123', name: 'prd-0123', ruleCount: 31, stages: { definition: { done: 31, total: 31, stale: 0 }, wireframe: { done: 0, total: 31, stale: 0 }, design: { done: 20, total: 31, stale: 2 }, code: { done: 5, total: 31, stale: 0 }, testCase: { done: 0, total: 31, stale: 0 } } },
        { level: 'prd', key: 'prd-0200', name: 'prd-0200', ruleCount: 0, stages: null },
      ],
    }));

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('prd-0123');
    expect(r.stdout).toContain('20/31 ⚠2');
    expect(r.stdout).toContain('prd-0200');
    expect(r.http.get.mock.calls[0][0]).toBe('/artifact-progress/products/10/progress');
  });

  it('status --level rp with --rp keeps only that rule point', async () => {
    const stages = { definition: { status: 'DONE', stale: false }, wireframe: { status: 'NOT_STARTED', stale: false }, design: { status: 'IN_PROGRESS', stale: true }, code: { status: 'DONE', stale: false }, testCase: { status: 'NOT_STARTED', stale: false }, testResult: { status: 'NO_RESULT', stale: false } };
    const r = await runCli(registerArtifactCommands, ['artifact', 'status', '--product', '10', '--level', 'rp', '--rp', 'RP-A-0001'],
      ok({ level: 'rp', rules: [{ code: 'rp-a-0001', fpCode: 'fun-a-0001', stages }, { code: 'rp-a-0002', fpCode: 'fun-a-0001', stages }] }));

    expect(r.stdout).toContain('rp-a-0001');
    expect(r.stdout).not.toContain('rp-a-0002');
    expect(r.stdout).toContain('◐ ⚠');
    expect(r.stdout).toContain('无结果');
  });

  it('status passes the filters through and validates them first', async () => {
    const r = await runCli(registerArtifactCommands, ['artifact', 'status', '--product', '10', '--level', 'fp', '--prd', 'prd-0123', '--stage', 'design', '--only-stale'], ok({ level: 'fp', rows: [] }));
    expect((r.http.get.mock.calls[0][1] as { params: object }).params).toMatchObject({ level: 'fp', prd: 'prd-0123', stage: 'design', onlyStale: true });
    expect(r.stdout).toContain('没有符合条件');

    const bad = await runCli(registerArtifactCommands, ['artifact', 'status', '--product', '10', '--only-not-started']);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain('--stage');
    expect(noHttpCalls(bad)).toBe(true);
    const badStage = await runCli(registerArtifactCommands, ['artifact', 'status', '--product', '10', '--stage', 'testResult']);
    expect(badStage.exitCode).toBe(1);
    expect(noHttpCalls(badStage)).toBe(true);
  });

  it('--json prints the raw rows', async () => {
    const rows = [{ level: 'prd', key: 'prd-0123', ruleCount: 1, stages: null }];
    const r = await runCli(registerArtifactCommands, ['artifact', 'status', '--product', '10', '--json'], ok({ level: 'prd', rows }));
    expect(JSON.parse(r.stdout)).toEqual(rows);
  });
});
