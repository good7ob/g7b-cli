/**
 * Local worktree-claim registry: `~/.good7ob/worktree-state.json`.
 *
 * Purpose: when several agents run on the same machine (possibly across different git worktrees
 * of the same repo), track which task owns which worktree path so a second agent can refuse to
 * start work on a path someone else already claimed, instead of both editing the same files.
 * This is a local, per-machine coordination file — never synced or sent to the backend.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface WorktreeEntry {
  taskId: string;
  worktreePath: string;
  branch: string | null;
  pid: number;
  summary: string | null;
  startedAt: string;
  heartbeat: string;
}

interface StateFile {
  entries: WorktreeEntry[];
}

const DEFAULT_STALE_MINUTES = 240;

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the pid exists but belongs to another user — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** An entry counts as active only if its owning process is alive AND it hasn't gone silent too long
 *  (guards against a reused pid long after the original agent exited). */
export function isEntryActive(entry: WorktreeEntry, staleMinutes = DEFAULT_STALE_MINUTES): boolean {
  const ageMs = Date.now() - new Date(entry.heartbeat).getTime();
  return isPidAlive(entry.pid) && Number.isFinite(ageMs) && ageMs < staleMinutes * 60_000;
}

export interface WorktreeStateOptions {
  /** Directory holding the state + lock file. Default `~/.good7ob`, resolved on every call so a changed HOME is honoured. */
  stateDir?: string;
  lockTimeoutMs?: number;
  lockStaleMs?: number;
}

export class WorktreeStateService {
  constructor(private readonly options: WorktreeStateOptions = {}) {}

  private get stateDir(): string {
    return this.options.stateDir ?? path.join(os.homedir(), '.good7ob');
  }

  get stateFile(): string {
    return path.join(this.stateDir, 'worktree-state.json');
  }

  get lockFile(): string {
    return `${this.stateFile}.lock`;
  }

  private read(): WorktreeEntry[] {
    if (!fs.existsSync(this.stateFile)) return [];
    let raw: StateFile;
    try {
      raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8')) as StateFile;
    } catch (err) {
      // Never treat a corrupt file as empty: the next write would silently wipe every other agent's claim.
      throw new Error(`worktree 状态文件损坏（${this.stateFile}）: ${(err as Error).message}。确认无其他 agent 在用后可删除该文件`);
    }
    return Array.isArray(raw?.entries) ? raw.entries : [];
  }

  private write(entries: WorktreeEntry[]): void {
    if (!fs.existsSync(this.stateDir)) fs.mkdirSync(this.stateDir, { recursive: true });
    const tmp = `${this.stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ entries }, null, 2), 'utf-8');
    fs.renameSync(tmp, this.stateFile); // rename is atomic on the same filesystem — readers never see a half-written file
  }

  /**
   * Naive cross-process lock (exclusive-create file, busy-retried) guarding read-modify-write of the
   * state file. Good enough for a handful of local CLI calls; a lock left behind by a crashed process
   * is force-cleared once it's older than LOCK_STALE_MS.
   * ponytail: single global lock file, move to per-path locks if this ever shows real contention.
   * ponytail: two waiters that both see the same stale lock can race (B may unlink the fresh lock A just took);
   * only reachable after a crash left a lock behind, upgrade to a lockfile-with-owner-pid check if it bites.
   */
  private async withLock<T>(fn: () => T): Promise<T> {
    const LOCK_STALE_MS = this.options.lockStaleMs ?? 10_000;
    const TIMEOUT_MS = this.options.lockTimeoutMs ?? 5_000;
    const start = Date.now();
    if (!fs.existsSync(this.stateDir)) fs.mkdirSync(this.stateDir, { recursive: true });
    for (;;) {
      try {
        fs.closeSync(fs.openSync(this.lockFile, 'wx'));
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        try {
          if (Date.now() - fs.statSync(this.lockFile).mtimeMs > LOCK_STALE_MS) {
            fs.unlinkSync(this.lockFile);
            continue;
          }
        } catch {
          continue; // lock file disappeared between the check and the stat — just retry
        }
        if (Date.now() - start > TIMEOUT_MS) {
          throw new Error(`获取本地锁超时（${this.lockFile}），可能有其他 worktree 命令卡住`);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    try {
      return fn();
    } finally {
      try {
        fs.unlinkSync(this.lockFile);
      } catch {
        /* already gone */
      }
    }
  }

  list(): WorktreeEntry[] {
    return this.read();
  }

  /** Drops entries whose owning process is gone / has gone silent too long, and persists the prune. */
  async prune(staleMinutes = DEFAULT_STALE_MINUTES): Promise<WorktreeEntry[]> {
    return this.withLock(() => {
      const kept = this.read().filter((e) => isEntryActive(e, staleMinutes));
      this.write(kept);
      return kept;
    });
  }

  /**
   * Claims a worktree for a task. Fails if a different, still-active task already holds the same
   * path, or the same task is active on a different path — unless `force` is set.
   */
  async claim(input: {
    taskId: string;
    worktreePath: string;
    branch: string | null;
    pid: number;
    summary: string | null;
    force: boolean;
  }): Promise<WorktreeEntry> {
    return this.withLock(() => {
      const now = new Date().toISOString();
      const active = this.read().filter((e) => isEntryActive(e));

      const pathConflict = active.find((e) => e.worktreePath === input.worktreePath && e.taskId !== input.taskId);
      if (pathConflict && !input.force) {
        throw new Error(
          `worktree 已被任务 #${pathConflict.taskId} 占用（pid ${pathConflict.pid}，心跳 ${pathConflict.heartbeat}）。确认无冲突后可加 --force 抢占。`
        );
      }
      const taskConflict = active.find((e) => e.taskId === input.taskId && e.worktreePath !== input.worktreePath);
      if (taskConflict && !input.force) {
        throw new Error(
          `任务 #${input.taskId} 已在另一个 worktree 活跃: ${taskConflict.worktreePath}（pid ${taskConflict.pid}）。用 --force 覆盖，或先 release。`
        );
      }

      const entry: WorktreeEntry = {
        taskId: input.taskId,
        worktreePath: input.worktreePath,
        branch: input.branch,
        pid: input.pid,
        summary: input.summary,
        startedAt: now,
        heartbeat: now,
      };
      const rest = active.filter((e) => e.taskId !== input.taskId && e.worktreePath !== input.worktreePath);
      this.write([...rest, entry]);
      return entry;
    });
  }

  async heartbeat(taskId: string, pid?: number): Promise<WorktreeEntry> {
    return this.withLock(() => {
      const entries = this.read();
      const found = entries.find((e) => e.taskId === taskId);
      if (!found) throw new Error(`没有找到任务 #${taskId} 的 worktree 记录`);
      const entry: WorktreeEntry = { ...found, heartbeat: new Date().toISOString(), pid: pid ?? found.pid };
      this.write(entries.map((e) => (e === found ? entry : e)));
      return entry;
    });
  }

  async release(taskId: string): Promise<boolean> {
    return this.withLock(() => {
      const entries = this.read();
      const next = entries.filter((e) => e.taskId !== taskId);
      this.write(next);
      return next.length !== entries.length;
    });
  }
}

export default new WorktreeStateService();
