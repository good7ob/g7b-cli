/**
 * prd-0121 FP-2 rp-gjob-0009..0015 (g7b #1601). Every test runs against a throwaway home dir so the real
 * ~/.good7ob is never read or written (os.homedir() is mocked, see worktree.test.ts for why).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerSyncCommands } from '../index';
import { bizError, ok, runCli } from '../../../utils/__tests__/cliHarness';

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as typeof import('os');
  const homedir = () => (globalThis as { __syncTestHome?: string }).__syncTestHome ?? '/nonexistent-test-home';
  return { ...actual, default: { ...actual, homedir }, homedir };
});

const USER = { actorType: 'USER', userId: 11, channel: 'CLI' };
const EMPLOYEE = { actorType: 'AGENT', userId: 11, channel: 'CLI', employee: { id: 3, orgId: 58, nickname: 'MacPro' } };

const activity = (id: number, over: Record<string, unknown> = {}) => ({
  source: 'ACTIVITY', reasons: ['ASSIGNED'], id, projectId: 4, taskId: 1600, taskName: '组织级增量接口',
  type: 'STATUS_CHANGED', actorType: 'USER', actorId: '11', actorName: '杨健', summary: 's',
  createdAt: '2026-10-13T09:30:00', ...over,
});
const mention = (id: number) => ({
  source: 'MENTION', reasons: ['MENTIONED'], id, projectId: 4, taskId: 1600, taskName: '组织级增量接口',
  type: 'COMMENT_POSTED', actorType: 'USER', actorId: '12', actorName: '阿明', summary: '@杨健 看一下游标',
  createdAt: '2026-10-13T09:41:00', commentId: id, targetType: 'TASK', targetId: 1600,
});
const page = (items: unknown[], nextCursor: string, hasMore = false, windowStart: string | null = null) =>
  ({ items, nextCursor, hasMore, windowStart });

/** actor on /me/actor, then the given sync pages in order (the last one repeats). */
const server = (actor: unknown, pages: unknown[]) => {
  let n = 0;
  return (_m: string, url: string) => {
    if (url === '/api/v1/me/actor') return ok(actor);
    if (/\/activities\/sync$/.test(url)) return ok(pages[Math.min(n++, pages.length - 1)]);
    return bizError(404, `unexpected ${url}`);
  };
};

let home: string;
const stateDir = () => path.join(home, '.good7ob', 'sync');
const stateFile = (key: string) => path.join(stateDir(), `${key}.json`);
const readState = (key: string) => JSON.parse(fs.readFileSync(stateFile(key), 'utf-8'));
const sync = (args: string[], responder: ReturnType<typeof server>) => runCli(registerSyncCommands, ['sync', ...args], responder);
const syncCalls = (r: Awaited<ReturnType<typeof sync>>) =>
  r.http.get.mock.calls.filter((c) => /\/activities\/sync$/.test(String(c[0])));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-sync-'));
  (globalThis as { __syncTestHome?: string }).__syncTestHome = home;
  delete process.env.GOOD7OB_ORG_ID;
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('sync — first run', () => {
  it('asks the server for the feed without a cursor, saves the cursor and prints what changed', async () => {
    const r = await sync(['--org-id', '58'], server(USER, [page([activity(1), activity(2, { type: 'TASK_COMPLETED' }), mention(9)], 'a2.c9.w100', false, '2026-10-06T09:00:00')]));
    expect(r.exitCode).toBeUndefined();
    const [url, cfg] = syncCalls(r)[0];
    expect(url).toBe('/api/v1/orgs/58/activities/sync');
    expect((cfg as { params: Record<string, unknown> }).params.cursor).toBeUndefined();
    expect(readState('user-11-org58').cursor).toBe('a2.c9.w100');
    expect(r.stdout).toContain('首次同步');
    expect(r.stdout).toContain('2026-10-06 09:00:00');
    expect(r.stdout).toContain('#1600');
    expect(r.stdout).toContain('组织级增量接口');
    expect(r.stdout).toContain('STATUS_CHANGED');
    expect(r.stdout).toContain('TASK_COMPLETED');
    expect(r.stdout).toContain('阿明');
    expect(r.stdout).toContain('@杨健 看一下游标');
  });

  it('says so when nothing changed, and still saves the cursor so the window floor sticks', async () => {
    const r = await sync(['--org-id', '58'], server(USER, [page([], 'a0.c0.w100', false, '2026-10-06T09:00:00')]));
    expect(r.stdout).toContain('无新的变化');
    expect(readState('user-11-org58').cursor).toBe('a0.c0.w100');
  });
});

describe('sync — incremental', () => {
  it('sends the saved cursor on the next run', async () => {
    await sync(['--org-id', '58'], server(USER, [page([activity(1)], 'a1.c0.w100')]));
    const r = await sync(['--org-id', '58'], server(USER, [page([activity(2)], 'a2.c0.w100')]));
    expect((syncCalls(r)[0][1] as { params: Record<string, unknown> }).params.cursor).toBe('a1.c0.w100');
    expect(r.stdout).not.toContain('首次同步');
    expect(readState('user-11-org58').cursor).toBe('a2.c0.w100');
  });

  it('--full ignores the saved cursor', async () => {
    await sync(['--org-id', '58'], server(USER, [page([activity(1)], 'a1.c0.w100')]));
    const r = await sync(['--org-id', '58', '--full'], server(USER, [page([activity(1)], 'a1.c0.w200')]));
    expect((syncCalls(r)[0][1] as { params: Record<string, unknown> }).params.cursor).toBeUndefined();
    expect(readState('user-11-org58').cursor).toBe('a1.c0.w200');
  });

  it('follows hasMore across pages and keeps every item', async () => {
    const r = await sync(['--org-id', '58', '--json'], server(USER, [
      page([activity(1)], 'a1.c0.w100', true), page([activity(2), mention(5)], 'a2.c5.w100', false)]));
    const out = JSON.parse(r.stdout);
    expect(out.items).toHaveLength(3);
    expect(out.nextCursor).toBe('a2.c5.w100');
    expect(syncCalls(r)).toHaveLength(2);
    expect((syncCalls(r)[1][1] as { params: Record<string, unknown> }).params.cursor).toBe('a1.c0.w100');
  });
});

describe('sync — failure leaves the cursor alone (rp-gjob-0015)', () => {
  it('does not advance when a later page fails', async () => {
    await sync(['--org-id', '58'], server(USER, [page([activity(1)], 'a1.c0.w100')]));
    let n = 0;
    const flaky = (_m: string, url: string) => {
      if (url === '/api/v1/me/actor') return ok(USER);
      return n++ === 0 ? ok(page([activity(2)], 'a2.c0.w100', true)) : bizError(500, 'down');
    };
    const r = await sync(['--org-id', '58'], flaky);
    expect(r.exitCode).toBe(1);
    expect(readState('user-11-org58').cursor).toBe('a1.c0.w100');
  });

  it('is read-only: it never POSTs, PUTs or DELETEs', async () => {
    const r = await sync(['--org-id', '58'], server(USER, [page([activity(1)], 'a1.c0.w100')]));
    expect(r.http.post).not.toHaveBeenCalled();
    expect(r.http.put).not.toHaveBeenCalled();
    expect(r.http.delete).not.toHaveBeenCalled();
  });

  it('stops on a rejected login without retrying and without writing state', async () => {
    const r = await sync(['--org-id', '58'], () => bizError(401, 'expired'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('未登录或凭证已失效');
    expect(r.http.get).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(stateDir())).toBe(false);
  });

  it('refuses a corrupt state file instead of treating it as empty', async () => {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(stateFile('user-11-org58'), '{not json');
    const r = await sync(['--org-id', '58'], server(USER, [page([], 'a0.c0.w1')]));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('损坏');
  });
});

describe('sync — identity and organization', () => {
  it('keeps users and orgs apart: another org starts from scratch', async () => {
    await sync(['--org-id', '58'], server(USER, [page([activity(1)], 'a1.c0.w100')]));
    const r = await sync(['--org-id', '59'], server(USER, [page([], 'a0.c0.w200')]));
    expect((syncCalls(r)[0][1] as { params: Record<string, unknown> }).params.cursor).toBeUndefined();
    expect(fs.existsSync(stateFile('user-11-org59'))).toBe(true);
    expect(readState('user-11-org58').cursor).toBe('a1.c0.w100');
  });

  it('an AI employee needs no --org-id: it uses its own organization and its own state key', async () => {
    const r = await sync([], server(EMPLOYEE, [page([activity(1)], 'a1.c0.w100')]));
    expect(r.exitCode).toBeUndefined();
    expect(syncCalls(r)[0][0]).toBe('/api/v1/orgs/58/activities/sync');
    expect(fs.existsSync(stateFile('emp-3-org58'))).toBe(true);
    expect(r.stdout).toContain('AI 员工');
  });

  it('an AI employee cannot sync a different organization', async () => {
    const r = await sync(['--org-id', '99'], server(EMPLOYEE, [page([], 'a0.c0.w1')]));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('AI 员工');
    expect(syncCalls(r)).toHaveLength(0);
  });

  it('a user without any organization gets a clear message and no state', async () => {
    const r = await sync([], server(USER, [page([], 'a0.c0.w1')]));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('缺少组织');
  });
});

describe('sync — output', () => {
  it('--json carries identity, first-run flag, window and items', async () => {
    const r = await sync(['--org-id', '58', '--json'], server(USER, [page([activity(1)], 'a1.c0.w100', false, '2026-10-06T09:00:00')]));
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ identity: { kind: 'user', id: 11 }, orgId: 58, firstSync: true,
      windowStart: '2026-10-06T09:00:00', nextCursor: 'a1.c0.w100', truncated: false });
    expect(out.items).toHaveLength(1);
  });

  it('strips control characters coming from the server', async () => {
    const r = await sync(['--org-id', '58'], server(USER, [page([activity(1, { taskName: 'x\x1b[2Jy' })], 'a1.c0.w1')]));
    expect(r.stdout).not.toContain('\x1b');
  });

  it('rejects a bad --limit before any request', async () => {
    const r = await sync(['--org-id', '58', '--limit', '0'], server(USER, [page([], 'a0.c0.w1')]));
    expect(r.exitCode).toBe(1);
    expect(r.http.get).not.toHaveBeenCalled();
  });

  it('shows our own timestamp as JST and drops fractional seconds from server times', async () => {
    await sync(['--org-id', '58'], server(USER, [page([], 'a0.c0.w1')]));
    const file = stateFile('user-11-org58');
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    fs.writeFileSync(file, JSON.stringify({ ...saved, lastSyncAt: '2026-10-13T07:02:12.705Z' }));
    const r = await sync(['--org-id', '58'], server(USER, [page([activity(1, { createdAt: '2026-10-06T17:15:53.233777' })], 'a1.c0.w1')]));
    expect(r.stdout).toContain('上次同步：2026-10-13 16:02:12');
    expect(r.stdout).toContain('最近 2026-10-06 17:15:53 ');
    expect(r.stdout).not.toContain('233777');
  });

  it('lists at most 30 tasks in the text view and counts the rest, while --json keeps all', async () => {
    const many = Array.from({ length: 35 }, (_, i) => activity(i + 1, { taskId: 2000 + i, taskName: `任务${i}` }));
    const text = await sync(['--org-id', '58'], server(USER, [page(many, 'a35.c0.w1')]));
    expect(text.stdout).toContain('35 个任务有变化');
    expect(text.stdout).toContain('另有 5 个任务有变化');
    expect(text.stdout).not.toContain('#2034 ');
    const json = await sync(['--org-id', '58', '--json', '--full'], server(USER, [page(many, 'a35.c0.w1')]));
    expect(JSON.parse(json.stdout).items).toHaveLength(35);
  });
});
