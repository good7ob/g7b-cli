/**
 * prd-0098 rp-forge-cliworktree-0001..0011. Every test runs against a throwaway home dir so the real
 * ~/.good7ob is never read or written. os.homedir() is mocked rather than setting $HOME: vitest runs specs in
 * worker threads, whose process.env is a private copy that libuv's homedir lookup never sees.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile, execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerWorktreeCommands } from '../index';
import { runCli } from '../../../utils/__tests__/cliHarness';
import { WorktreeEntry, WorktreeStateService, isEntryActive } from '../../../services/WorktreeStateService';

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as typeof import('os');
  const homedir = () => (globalThis as { __wtTestHome?: string }).__wtTestHome ?? '/nonexistent-test-home';
  return { ...actual, default: { ...actual, homedir }, homedir };
});

const LIVE = String(process.pid);
const MIN = 60_000;

let home: string;

const stateFile = () => path.join(home, '.good7ob', 'worktree-state.json');
const readState = (): WorktreeEntry[] => JSON.parse(fs.readFileSync(stateFile(), 'utf-8')).entries;
const writeState = (entries: WorktreeEntry[]) => {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify({ entries }));
};
const wt = (args: string[]) => runCli(registerWorktreeCommands, ['worktree', ...args]);
const claim = (task: string, p: string, ...extra: string[]) => wt(['claim', '--task', task, '--path', p, '--pid', LIVE, ...extra]);

/** pid of a process that has already exited. */
function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '']).pid;
}

function entry(over: Partial<WorktreeEntry>): WorktreeEntry {
  const now = new Date().toISOString();
  return { taskId: '1', worktreePath: '/repo/A', branch: null, pid: process.pid, summary: null, startedAt: now, heartbeat: now, ...over };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'good7ob-wt-'));
  (globalThis as { __wtTestHome?: string }).__wtTestHome = home;
  // hard stop: if the stub ever stops reaching the service, fail before touching the real file
  if (new WorktreeStateService().stateFile !== stateFile()) throw new Error('homedir stub not effective');
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('worktree claim', () => {
  it('writes into the temp HOME, never the real one', async () => {
    await claim('1', '/repo/A');
    expect(os.homedir()).toBe(home);
    expect(fs.existsSync(stateFile())).toBe(true);
  });

  it('rp-0001/0003: --path defaults to cwd (absolute), --pid to the parent process', async () => {
    const r = await wt(['claim', '--task', '1', '--json']);
    expect(r.exitCode).toBeUndefined();
    const [e] = readState();
    expect(e.worktreePath).toBe(path.resolve(process.cwd()));
    expect(e.pid).toBe(process.ppid);
  });

  it('rp-0001: a relative --path is stored absolute', async () => {
    await claim('1', 'some/rel');
    expect(readState()[0].worktreePath).toBe(path.resolve('some/rel'));
  });

  it('rp-0002: branch is detected via git; a non-git dir leaves it null without failing', async () => {
    const repoRoot = path.resolve(__dirname, '../../../../');
    const branch = execFileSync('git', ['-C', repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
    await claim('1', repoRoot);
    expect(readState()[0].branch).toBe(branch);

    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'good7ob-wt-nogit-'));
    const r = await claim('3', plain);
    fs.rmSync(plain, { recursive: true, force: true });
    expect(r.exitCode).toBeUndefined();
    expect(readState().find((e) => e.taskId === '3')?.branch).toBeNull();
  });

  it('--branch overrides detection', async () => {
    const r = await claim('1', '/repo/A', '--branch', 'feat/x');
    expect(r.stdout).toContain('✓ 任务 #1 已占用 worktree: /repo/A (feat/x)');
  });

  it('rp-0004: another active task on the same path is rejected with its task / pid / heartbeat', async () => {
    await claim('1', '/repo/A');
    const hb = readState()[0].heartbeat;
    const r = await claim('2', '/repo/A');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('已被任务 #1 占用');
    expect(r.stderr).toContain(`pid ${LIVE}`);
    expect(r.stderr).toContain(hb);
    expect(readState().map((e) => e.taskId)).toEqual(['1']);
  });

  it('rp-0004: a stale holder (dead pid) does not block the path', async () => {
    writeState([entry({ taskId: '1', pid: deadPid() })]);
    const r = await claim('2', '/repo/A');
    expect(r.exitCode).toBeUndefined();
    expect(readState().map((e) => e.taskId)).toEqual(['2']);
  });

  it('rp-0005: the same task active on another path is rejected', async () => {
    await claim('1', '/repo/A');
    const r = await claim('1', '/repo/B');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('已在另一个 worktree 活跃: /repo/A');
  });

  it('rp-0006: --force steals a path claim; the old holder is gone', async () => {
    await claim('1', '/repo/A');
    const r = await claim('2', '/repo/A', '--force');
    expect(r.exitCode).toBeUndefined();
    expect(readState().map((e) => [e.taskId, e.worktreePath])).toEqual([['2', '/repo/A']]);
  });

  it('rp-0006: --force moves a task to a new path; the old path entry is dropped', async () => {
    await claim('1', '/repo/A');
    const r = await claim('1', '/repo/B', '--force');
    expect(r.exitCode).toBeUndefined();
    expect(readState().map((e) => [e.taskId, e.worktreePath])).toEqual([['1', '/repo/B']]);
  });

  it('rp-0007: re-claiming the same task + path refreshes heartbeat and startedAt, no conflict', async () => {
    writeState([entry({ taskId: '1', startedAt: '2026-01-01T00:00:00.000Z', heartbeat: new Date(Date.now() - 10 * MIN).toISOString() })]);
    const r = await claim('1', '/repo/A');
    expect(r.exitCode).toBeUndefined();
    const state = readState();
    expect(state).toHaveLength(1);
    expect(state[0].startedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(Date.now() - new Date(state[0].heartbeat).getTime()).toBeLessThan(MIN);
  });

  it('rejects a non-numeric --pid / --task instead of storing a dead claim', async () => {
    const r = await wt(['claim', '--task', '1', '--path', '/repo/A', '--pid', 'abc']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--pid');
    expect(fs.existsSync(stateFile())).toBe(false);
    const t = await wt(['claim', '--task', 'x', '--path', '/repo/A', '--pid', LIVE]);
    expect(t.exitCode).toBe(1);
    expect(t.stderr).toContain('--task');
  });
});

describe('liveness (rp-0008)', () => {
  it('needs a live pid AND a heartbeat younger than 240 minutes', () => {
    const ago = (m: number) => new Date(Date.now() - m * MIN).toISOString();
    expect(isEntryActive(entry({ heartbeat: ago(0) }))).toBe(true);
    expect(isEntryActive(entry({ heartbeat: ago(239) }))).toBe(true);
    expect(isEntryActive(entry({ heartbeat: ago(241) }))).toBe(false);
    expect(isEntryActive(entry({ pid: deadPid() }))).toBe(false);
    expect(isEntryActive(entry({ pid: 0 }))).toBe(false);
    expect(isEntryActive(entry({ heartbeat: 'garbage' }))).toBe(false);
  });

  it('treats EPERM (pid owned by another user) as alive', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    });
    expect(isEntryActive(entry({ pid: 1 }))).toBe(true);
  });
});

describe('worktree list (rp-0009)', () => {
  const seed = () =>
    writeState([
      entry({ taskId: '1', worktreePath: '/repo/A' }),
      entry({ taskId: '9', worktreePath: '/repo/Dead', pid: deadPid() }),
      entry({ taskId: '8', worktreePath: '/repo/Old', heartbeat: new Date(Date.now() - 300 * MIN).toISOString() }),
    ]);

  it('prunes dead-pid and silent entries, persists the prune, shows only active', async () => {
    seed();
    const r = await wt(['list']);
    expect(r.stdout).toContain('#1');
    expect(r.stdout).toContain('活跃');
    expect(r.stdout).not.toContain('#9');
    expect(r.stdout).not.toContain('#8');
    expect(readState().map((e) => e.taskId)).toEqual(['1']);
  });

  it('--all lists stale entries too, marks them, and does not prune', async () => {
    seed();
    const r = await wt(['list', '--all']);
    expect(r.stdout).toContain('#9');
    expect(r.stdout).toContain('#8');
    expect(r.stdout).toContain('疑似失效');
    expect(readState()).toHaveLength(3);
  });

  it('--json returns the entries; empty state prints the placeholder', async () => {
    expect((await wt(['list'])).stdout).toContain('没有 worktree 占用记录');
    seed();
    const r = await wt(['list', '--json']);
    expect(JSON.parse(r.stdout).map((e: WorktreeEntry) => e.taskId)).toEqual(['1']);
  });
});

describe('worktree heartbeat (rp-0010)', () => {
  it('refreshes heartbeat and optionally pid', async () => {
    writeState([entry({ taskId: '1', heartbeat: new Date(Date.now() - 100 * MIN).toISOString() })]);
    const r = await wt(['heartbeat', '--task', '1', '--pid', '4242']);
    expect(r.stdout).toContain('✓ 任务 #1 心跳已更新');
    const [e] = readState();
    expect(e.pid).toBe(4242);
    expect(Date.now() - new Date(e.heartbeat).getTime()).toBeLessThan(MIN);
  });

  it('a missing task exits non-zero', async () => {
    const r = await wt(['heartbeat', '--task', '9']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('没有找到任务 #9 的 worktree 记录');
  });

  it('a pruned dead-pid entry is missing afterwards', async () => {
    writeState([entry({ taskId: '9', pid: deadPid() })]);
    await wt(['list']);
    expect((await wt(['heartbeat', '--task', '9'])).exitCode).toBe(1);
  });
});

describe('worktree release (rp-0011)', () => {
  it('releases a claim, then is idempotent (exit 0, "没有占用记录")', async () => {
    await claim('5', '/repo/C');
    const r = await wt(['release', '--task', '5']);
    expect(r.stdout).toContain('✓ 任务 #5 的 worktree 占用已释放');
    expect(readState()).toEqual([]);

    const again = await wt(['release', '--task', '5']);
    expect(again.exitCode).toBeUndefined();
    expect(again.stdout).toContain('任务 #5 没有占用记录');

    const json = await wt(['release', '--task', '7', '--json']);
    expect(JSON.parse(json.stdout)).toEqual({ released: false, taskId: '7' });
  });
});

describe('state file + lock', () => {
  const svc = () => new WorktreeStateService({ stateDir: path.join(home, '.good7ob'), lockTimeoutMs: 300, lockStaleMs: 10_000 });
  const input = (taskId: string, worktreePath: string) => ({ taskId, worktreePath, branch: null, pid: process.pid, summary: null, force: false });

  it('writes via temp file + rename: no temp or lock files left behind', async () => {
    await svc().claim(input('1', '/repo/A'));
    expect(fs.readdirSync(path.join(home, '.good7ob'))).toEqual(['worktree-state.json']);
  });

  it('waits for a held lock and proceeds once it is released', async () => {
    const s = svc();
    fs.mkdirSync(path.dirname(s.lockFile), { recursive: true });
    fs.writeFileSync(s.lockFile, '');
    setTimeout(() => fs.unlinkSync(s.lockFile), 100);
    await s.claim(input('1', '/repo/A'));
    expect(readState().map((e) => e.taskId)).toEqual(['1']);
  });

  it('times out on a fresh lock that is never released', async () => {
    const s = svc();
    fs.mkdirSync(path.dirname(s.lockFile), { recursive: true });
    fs.writeFileSync(s.lockFile, '');
    await expect(s.claim(input('1', '/repo/A'))).rejects.toThrow('获取本地锁超时');
    expect(fs.existsSync(s.stateFile)).toBe(false);
  });

  it('clears a stale lock (crashed holder) and proceeds', async () => {
    const s = svc();
    fs.mkdirSync(path.dirname(s.lockFile), { recursive: true });
    fs.writeFileSync(s.lockFile, '');
    const old = (Date.now() - 60_000) / 1000;
    fs.utimesSync(s.lockFile, old, old);
    await s.claim(input('1', '/repo/A'));
    expect(fs.existsSync(s.lockFile)).toBe(false);
    expect(readState()).toHaveLength(1);
  });

  it('refuses to overwrite a corrupt state file', async () => {
    fs.mkdirSync(path.join(home, '.good7ob'), { recursive: true });
    fs.writeFileSync(stateFile(), '{not json');
    const r = await claim('1', '/repo/A');
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('状态文件损坏');
    expect(fs.readFileSync(stateFile(), 'utf-8')).toBe('{not json');
  });

  it('concurrent claims from separate processes lose no update', async () => {
    const dir = path.join(home, '.good7ob');
    const svcPath = path.resolve(__dirname, '../../../services/WorktreeStateService.ts');
    const script = (i: number) =>
      `const { WorktreeStateService } = require(${JSON.stringify(svcPath)});` +
      `new WorktreeStateService({ stateDir: ${JSON.stringify(dir)} }).claim({ taskId: '${i}', worktreePath: '/repo/${i}', branch: null, pid: ${process.pid}, summary: null, force: false })` +
      `.catch((e) => { console.error(e); process.exit(1); });`;
    const N = 6;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        new Promise<void>((resolve, reject) =>
          execFile(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', script(i)], (err) => (err ? reject(err) : resolve()))
        )
      )
    );
    expect(readState().map((e) => e.taskId).sort()).toEqual(Array.from({ length: N }, (_, i) => String(i)).sort());
  }, 60_000);
});
