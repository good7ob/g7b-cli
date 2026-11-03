/**
 * `good7ob cache pull|status` — local Markdown cache of a product's PRDs, design docs, UI design and tasks.
 * Every test runs against a throwaway home dir so the real ~/.good7ob is never touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerCacheCommands } from '../index';
import { bizError, ok, runCli } from '../../../utils/__tests__/cliHarness';

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as typeof import('os');
  const homedir = () => (globalThis as { __cacheTestHome?: string }).__cacheTestHome ?? '/nonexistent-test-home';
  return { ...actual, default: { ...actual, homedir }, homedir };
});

const USER = { actorType: 'USER', userId: 11, channel: 'CLI' };
const prdRow = (id: number, updatedAt = 1000) => ({ prdId: String(id), prdNo: `prd-${id}`, title: `PRD ${id}`, status: 'draft', updatedAt });

interface World {
  prds?: unknown[];
  failPrdDetail?: boolean;
  designs?: unknown[];
  tasks?: unknown[];
}

const server = (w: World = {}) => (_m: string, url: string) => {
  if (url === '/api/v1/me/actor') return ok(USER);
  if (url === '/forge/prd/prds') return ok({ list: w.prds ?? [prdRow(516), prdRow(187)], total: (w.prds ?? [0, 0]).length || 2 });
  const detail = url.match(/^\/forge\/prd\/prds\/(\d+)$/);
  if (detail) {
    if (w.failPrdDetail) return bizError(500, 'boom');
    return ok({ ...prdRow(Number(detail[1])), version: '1.0.1', currentDocument: detail[1] === '516' ? { contentMd: '# 正文 516' } : null });
  }
  if (url === '/forge/products/10/designs') {
    const records = w.designs ?? [{ docNo: 'db-0001', docType: 'db', title: '库表', status: 'published', updatedAt: '2026-11-03T10:00:00' }];
    return ok({ records, total: records.length });
  }
  const dd = url.match(/^\/forge\/products\/10\/designs\/([^/]+)$/);
  if (dd) return ok({ docNo: dd[1], title: '库表', publishedVersion: { versionLabel: 'v1', contentMd: '## 设计正文' }, draftVersion: null });
  if (url === '/forge/ui-design/apps') {
    return ok([{ id: 1, name: 'web', platform: 'web', productId: null }, { id: 2, name: 'other-product', platform: 'web', productId: 99 }]);
  }
  if (url === '/forge/ui-design/apps/1/screens') return ok([{ id: 5, name: '登录页', sortOrder: 0 }]);
  if (url === '/forge/ui-design/apps/1/flows') return ok([{ id: 9, name: '登录流程' }]);
  if (url === '/forge/ui-design/flows/9/nodes') return ok([{ id: 1, fromScreenId: 5, toScreenId: 5, trigger: '点击登录' }]);
  if (url === '/progress/projects') return ok({ total: 1, list: [{ id: 4, name: 'good7ob', productId: 10 }] });
  if (url === '/progress/projects/4/tasks') {
    return ok(w.tasks ?? [{ id: 1600, taskNo: 12, name: '组织级增量接口', status: 'in_progress', priority: 'high', description: '做增量' }]);
  }
  return bizError(404, `unexpected ${url}`);
};

let home: string;
const root = () => path.join(home, '.good7ob', 'cache', 'user-11-org58', 'product-10');
const read = (rel: string) => fs.readFileSync(path.join(root(), rel), 'utf-8');
const pull = (args: string[], responder = server()) =>
  runCli(registerCacheCommands, ['cache', 'pull', '--product', '10', '--org-id', '58', ...args], responder);
const urls = (r: Awaited<ReturnType<typeof pull>>) => r.http.get.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-cache-'));
  (globalThis as { __cacheTestHome?: string }).__cacheTestHome = home;
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('cache pull', () => {
  it('writes PRDs, design docs, UI design and tasks as Markdown plus an index per section', async () => {
    const r = await pull([]);
    expect(r.exitCode).toBeUndefined();
    expect(read('prd/prd-516.md')).toContain('# 正文 516');
    expect(read('prd/prd-187.md')).toContain('尚无正文');
    expect(read('prd/INDEX.md')).toContain('prd-516');
    expect(read('design/db-0001.md')).toContain('## 设计正文');
    const ui = read('ui/ui.md');
    expect(ui).toContain('登录页');
    expect(ui).toContain('点击登录');
    expect(ui).not.toContain('other-product');
    expect(read('tasks/INDEX.md')).toContain('组织级增量接口');
    expect(JSON.parse(read('tasks/tasks.json'))[0].description).toBe('做增量');
    const sections = JSON.parse(read('manifest.json')).sections;
    expect([sections.prd.count, sections.design.count, sections.ui.count, sections.tasks.count]).toEqual([2, 1, 1, 1]);
  });

  it('is incremental: an unchanged PRD is not fetched again, a changed one is', async () => {
    await pull([]);
    const second = await pull([], server({ prds: [prdRow(516, 1000), prdRow(187, 2000)] }));
    const detailCalls = urls(second).filter((u) => /\/forge\/prd\/prds\/\d+$/.test(u));
    expect(detailCalls).toEqual(['/forge/prd/prds/187']);
    expect(read('prd/prd-516.md')).toContain('# 正文 516'); // carried over from the previous pull
  });

  it('drops a PRD that no longer exists on the platform', async () => {
    await pull([]);
    await pull([], server({ prds: [prdRow(516)] }));
    expect(fs.existsSync(path.join(root(), 'prd', 'prd-187.md'))).toBe(false);
  });

  it('keeps the previous section and exits non-zero when one section fails', async () => {
    await pull([]);
    const r = await pull([], server({ prds: [prdRow(516, 9999)], failPrdDetail: true }));
    expect(r.exitCode).toBe(1);
    expect(read('prd/prd-187.md')).toContain('尚无正文'); // old PRD section untouched
    expect(read('design/db-0001.md')).toContain('## 设计正文'); // other sections still refreshed
    expect(JSON.parse(read('manifest.json')).errors.prd).toContain('boom');
  });

  it('never lets a platform-supplied doc number escape the cache directory', async () => {
    await pull([], server({ designs: [{ docNo: '../../evil', docType: 'db', title: 'x', updatedAt: 't' }] }));
    expect(fs.existsSync(path.join(home, '.good7ob', 'evil.md'))).toBe(false);
    expect(fs.existsSync(path.join(root(), 'design', '.._.._evil.md'))).toBe(true);
  });

  it('--only limits the sections that are pulled', async () => {
    const r = await pull(['--only', 'tasks']);
    expect(urls(r).some((u) => u.startsWith('/forge/prd'))).toBe(false);
    expect(fs.existsSync(path.join(root(), 'prd'))).toBe(false);
    expect(read('tasks/INDEX.md')).toContain('组织级增量接口');
  });

  it('rejects an unknown section name', async () => {
    const r = await pull(['--only', 'wiki']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('wiki');
  });
});

describe('cache status', () => {
  it('says nothing is cached before the first pull', async () => {
    const r = await runCli(registerCacheCommands, ['cache', 'status', '--product', '10', '--org-id', '58'], server());
    expect(r.stdout).toContain('尚未缓存');
  });

  it('shows when and how much was cached', async () => {
    await pull([]);
    const r = await runCli(registerCacheCommands, ['cache', 'status', '--product', '10', '--org-id', '58'], server());
    expect(r.stdout).toContain('prd');
    expect(r.stdout).toMatch(/2/);
    expect(r.stdout).toContain(root());
  });
});
