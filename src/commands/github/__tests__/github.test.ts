/** prd-0124 CLI side. gh is mocked at the ./gh module; HTTP via the shared harness. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerGithubCommands } from '../index';
import { batchesOf, collectPrs, mapPr, sinceFor, GhPr } from '../logic';
import { bizError, ok, runCli } from '../../../utils/__tests__/cliHarness';

vi.mock('../gh', () => ({ ghUser: vi.fn(), ghPrList: vi.fn() }));
import * as gh from '../gh';
const ghMock = { ghUser: vi.mocked(gh.ghUser), ghPrList: vi.mocked(gh.ghPrList) };

const row = (over: Partial<GhPr> = {}): GhPr => ({
  number: 7, title: 't', url: 'https://github.com/o/r/pull/7', state: 'MERGED', author: { login: 'bob' },
  additions: 3, deletions: 1, changedFiles: 2, baseRefName: 'main', headRefName: 'f',
  createdAt: '2026-10-01T01:00:00Z', mergedAt: '2026-10-02T01:00:00Z', closedAt: '2026-10-02T01:00:00Z',
  updatedAt: '2026-10-02T02:00:00Z', ...over,
});

describe('mapPr', () => {
  it('sends merged as closed and keeps mergedAt', () => {
    const i = mapPr('o/r', row());
    expect(i).toMatchObject({ repoFullName: 'o/r', prNumber: 7, state: 'closed', authorLogin: 'bob', htmlUrl: 'https://github.com/o/r/pull/7', baseRef: 'main', headRef: 'f', mergedAt: '2026-10-02T01:00:00Z' });
  });
  it('open PR: empty/zero-value timestamps become null', () => {
    const i = mapPr('o/r', row({ state: 'OPEN', mergedAt: '', closedAt: '0001-01-01T00:00:00Z' }));
    expect(i.state).toBe('open');
    expect(i.mergedAt).toBeNull();
    expect(i.closedAt).toBeNull();
  });
  it('closed unmerged', () => {
    expect(mapPr('o/r', row({ state: 'CLOSED', mergedAt: null })).state).toBe('closed');
  });
});

describe('sinceFor', () => {
  const now = new Date('2026-10-14T00:30:00Z'); // 09:30 JST on 10-14
  it('first sync = today(JST) - 90 days', () => expect(sinceFor(null, undefined, now)).toBe('2026-07-16'));
  it('lastSyncedAt - 1 day, naive string is JST wall time', () => expect(sinceFor('2026-10-10 00:10:00', undefined, now)).toBe('2026-10-09'));
  it('lastSyncedAt with Z is converted to JST first', () => expect(sinceFor('2026-10-09T20:00:00Z', undefined, now)).toBe('2026-10-09'));
  it('--since overrides', () => expect(sinceFor('2026-10-10 00:10:00', '2026-01-02', now)).toBe('2026-01-02'));
});

describe('batchesOf', () => {
  it('splits at 200', () => {
    const b = batchesOf(Array.from({ length: 401 }, (_, i) => i), 200);
    expect(b.map((x) => x.length)).toEqual([200, 200, 1]);
  });
});

describe('collectPrs', () => {
  const mk = (n: number, day: number) => row({ number: n, updatedAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z` });
  it('narrows with updated:<= the oldest updatedAt while a page is full', async () => {
    const p1 = Array.from({ length: 200 }, (_, i) => mk(1000 - i, 10));
    p1[199] = mk(801, 5);
    const fetchPage = vi.fn().mockResolvedValueOnce(p1).mockResolvedValueOnce([mk(801, 5), mk(1, 3)]);
    const r = await collectPrs('o/r', '2026-10-01', fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1][0]).toContain('updated:<=2026-10-05T00:00:00Z');
    expect(r.rows).toHaveLength(201); // 801 de-duplicated
    expect(r.capped).toBe(false);
  });
  it('warns when the page cap is hit', async () => {
    let d = 28;
    const fetchPage = vi.fn().mockImplementation(async () => { d -= 1; return Array.from({ length: 200 }, (_, i) => mk(d * 1000 + i, Math.max(d, 1))); });
    const r = await collectPrs('o/r', '2026-10-01', fetchPage, 3);
    expect(r.capped).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});

describe('github sync command', () => {
  afterEach(() => { vi.restoreAllMocks(); ghMock.ghUser.mockReset(); ghMock.ghPrList.mockReset(); });
  const binding = { id: 1, repoFullName: 'o/r', kind: 'code', isEnabled: true, lastSyncedAt: null };
  const server = (batch: (body: unknown) => unknown, bindings: unknown[] = [binding]) => (m: string, url: string) => {
    if (url.endsWith('/repo-bindings')) return ok(bindings);
    if (url.endsWith('/intg/github/accounts')) return ok({});
    if (url.endsWith('/pull-requests/batch')) return batch(null) as never;
    return bizError(404, url);
  };

  it('uploads mapped rows in batches of 200 and prints counts + unknown authors', async () => {
    ghMock.ghUser.mockReturnValue({ login: 'bob', id: 9 });
    ghMock.ghPrList.mockResolvedValue(Array.from({ length: 150 }, (_, i) => row({ number: i + 1, updatedAt: '2026-10-02T00:00:00Z' })));
    const r = await runCli(registerGithubCommands, ['github', 'sync', '--org-id', '58'], server(() => ok({ created: 150, updated: 0, skipped: 0, unknownAuthors: ['zed'] })));
    expect(r.exitCode).toBeUndefined();
    const call = r.http.post.mock.calls.find((c) => String(c[0]).endsWith('/batch'))!;
    expect(call[0]).toBe('/api/v1/orgs/58/github/pull-requests/batch');
    expect((call[1] as { items: unknown[] }).items).toHaveLength(150);
    expect(r.http.post.mock.calls.find((c) => String(c[0]).endsWith('/intg/github/accounts'))![1]).toEqual({ login: 'bob', uid: 9 });
    expect(r.stdout).toContain('150');
    expect(r.stdout).toContain('zed');
    expect(r.stdout).toContain('不会计入个人报表');
  });

  it('surfaces the whole-batch 1001 refusal and exits non-zero', async () => {
    ghMock.ghUser.mockReturnValue({ login: 'bob', id: 9 });
    ghMock.ghPrList.mockResolvedValue([row()]);
    const r = await runCli(registerGithubCommands, ['github', 'sync', '--org-id', '58'], server(() => bizError(1001, 'o/r 未登记')));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('o/r 未登记');
  });

  it('no enabled bindings: hint + non-zero', async () => {
    ghMock.ghUser.mockReturnValue({ login: 'bob', id: 9 });
    const r = await runCli(registerGithubCommands, ['github', 'sync', '--org-id', '58'], server(() => ok({}), [{ ...binding, isEnabled: false }]));
    expect(r.exitCode).toBe(1);
    expect(r.stderr + r.stdout).toContain('good7ob github repos add owner/name');
  });

  it('login owned by another user (1006) stops before any PR call', async () => {
    ghMock.ghUser.mockReturnValue({ login: 'bob', id: 9 });
    const r = await runCli(registerGithubCommands, ['github', 'sync', '--org-id', '58'], (m, url) => (url.endsWith('/accounts') ? bizError(1006, '已被他人绑定') : ok([binding])));
    expect(r.exitCode).toBe(1);
    expect(ghMock.ghPrList).not.toHaveBeenCalled();
  });
});

describe('repos subcommands', () => {
  it('add posts the body', async () => {
    const r = await runCli(registerGithubCommands, ['github', 'repos', 'add', 'o/r', '--kind', 'docs', '--org-id', '58', '--product-id', '4'], ok({ id: 1 }));
    expect(r.http.post.mock.calls[0]).toEqual(['/api/v1/orgs/58/repo-bindings', { repoFullName: 'o/r', kind: 'docs', productId: 4, productAppId: null }]);
  });
  it('add rejects a bad repo name before HTTP', async () => {
    const r = await runCli(registerGithubCommands, ['github', 'repos', 'add', 'nope', '--org-id', '58']);
    expect(r.exitCode).toBe(1);
    expect(r.http.post).not.toHaveBeenCalled();
  });
  it('set patches kind/enabled; remove deletes', async () => {
    const s = await runCli(registerGithubCommands, ['github', 'repos', 'set', '3', '--disable', '--kind', 'infra', '--org-id', '58'], ok({}));
    expect(s.http.patch.mock.calls[0]).toEqual(['/api/v1/orgs/58/repo-bindings/3', { kind: 'infra', enabled: false }]);
    const d = await runCli(registerGithubCommands, ['github', 'repos', 'remove', '3', '--org-id', '58'], ok({}));
    expect(d.http.delete.mock.calls[0][0]).toBe('/api/v1/orgs/58/repo-bindings/3');
  });
});
