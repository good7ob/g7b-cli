/**
 * Local single work slot for `good7ob agent`: ~/.good7ob/agent-state.json.
 * One CLI handles one task at a time; it does not claim while busy/timeout.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SlotTask {
  taskId: number;
  taskNo: string | number | null;
  name: string;
  projectId: number | null;
  claimedAt: string; // ISO
  deadline: string; // ISO, claimedAt + expected duration
  /** prd-0136: set when the scheduler assigned the task to this runner (N-4). */
  assignmentId?: number | null;
  runId?: number | null;
  stepId?: number | null;
  nodeCode?: string | null;
  /** ISO time the heartbeat told us to stop this step (the backend released it already). */
  stopRequestedAt?: string;
}

export type BusyState = { status: 'busy' | 'timeout' } & SlotTask;
export type AgentState = { status: 'idle' } | BusyState;

export const IDLE: AgentState = { status: 'idle' };

/** What `agent listen` registered this machine as (prd-0136 rp-auto-sched-0009); kept next to the slot. */
export interface RunnerRegistration {
  runnerId: number;
  runnerKey: string;
  hostLabel: string;
  slots: number;
  envTags: string[];
  agentKind: string;
  registeredAt: string; // ISO
}

/** Backend task status, or 'unknown' when the lookup failed. */
export type RemoteStatus = string | 'unknown';

export type Action = 'none' | 'finished' | 'release';

/**
 * Pure transition. 'finished' = the agent moved the task on (not in_progress any more), free the
 * slot without releasing. 'release' = past deadline + grace, hand it back to the queue; the caller
 * performs the release and only then persists the returned idle state.
 */
export function advance(
  state: AgentState,
  nowMs: number,
  remote: RemoteStatus,
  graceMinutes: number
): { state: AgentState; action: Action } {
  if (state.status === 'idle') return { state, action: 'none' };
  if (remote !== 'unknown' && remote !== 'in_progress') return { state: IDLE, action: 'finished' };
  const deadline = Date.parse(state.deadline);
  if (nowMs > deadline + graceMinutes * 60_000) return { state: IDLE, action: 'release' };
  const status = nowMs > deadline ? 'timeout' : 'busy';
  return { state: status === state.status ? state : { ...state, status }, action: 'none' };
}

export function busyState(
  task: { id: number; taskNo?: any; name?: string; projectId?: any; estimatedHours?: number | null },
  nowMs: number,
  expectedMinutes: number
): BusyState {
  const minutes = task.estimatedHours && task.estimatedHours > 0 ? task.estimatedHours * 60 : expectedMinutes;
  const slot: BusyState = {
    status: 'busy',
    taskId: task.id,
    taskNo: task.taskNo ?? null,
    name: task.name ?? '',
    projectId: task.projectId ?? null,
    claimedAt: new Date(nowMs).toISOString(),
    deadline: new Date(nowMs + minutes * 60_000).toISOString(),
  };
  const t = task as Record<string, any>;
  if (t.assignmentId != null) slot.assignmentId = t.assignmentId;
  if (t.runId != null) slot.runId = t.runId;
  if (t.stepId != null) slot.stepId = t.stepId;
  if (t.nodeCode) slot.nodeCode = t.nodeCode;
  return slot;
}

const LOCK_STALE_MS = 60_000;
const LOCK_TIMEOUT_MS = 70_000; // longer than the stale age so a crashed holder's lock can be taken over

export class AgentStateStore {
  constructor(private readonly dir: string = path.join(os.homedir(), '.good7ob')) {}

  get file(): string {
    return path.join(this.dir, 'agent-state.json');
  }

  private get lockFile(): string {
    return `${this.file}.lock`;
  }

  /** The whole file: the slot fields plus an optional `runner` registration. */
  private readRaw(): Record<string, any> {
    if (!fs.existsSync(this.file)) return {};
    try {
      const s = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
      return s && typeof s === 'object' ? s : {};
    } catch (e) {
      // A corrupt file must not silently become idle: that would claim a second task while one is running.
      throw new Error(`agent 状态文件损坏（${this.file}）: ${(e as Error).message}。确认后可用 good7ob agent reset 重置`);
    }
  }

  private writeRaw(raw: Record<string, any>): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf-8');
    fs.renameSync(tmp, this.file);
  }

  read(): AgentState {
    const { runner: _runner, ...s } = this.readRaw();
    return s?.status === 'busy' || s?.status === 'timeout' ? (s as AgentState) : IDLE;
  }

  /** Writes the slot; the runner registration in the same file is kept. */
  write(state: AgentState): void {
    let runner: RunnerRegistration | undefined;
    try {
      runner = this.readRunner() ?? undefined;
    } catch {
      /* corrupt file: the slot write replaces it, the registration is redone by the next listen */
    }
    this.writeRaw(runner ? { ...state, runner } : { ...state });
  }

  readRunner(): RunnerRegistration | null {
    const r = this.readRaw().runner;
    return r && typeof r.runnerId === 'number' && typeof r.runnerKey === 'string' ? (r as RunnerRegistration) : null;
  }

  /** Writes the registration; the slot in the same file is kept. `null` clears it. */
  writeRunner(runner: RunnerRegistration | null): void {
    const slot = this.read();
    this.writeRaw(runner ? { ...slot, runner } : { ...slot });
  }

  /**
   * Exclusive-create lock around read-modify-write, shared by `listen` and `next`.
   * ponytail: two waiters seeing the same stale lock can race; only after a crash, add owner-pid check if it bites.
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    fs.mkdirSync(this.dir, { recursive: true });
    const start = Date.now();
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
          continue; // lock vanished between checks
        }
        if (Date.now() - start > LOCK_TIMEOUT_MS) throw new Error(`获取本地锁超时（${this.lockFile}）`);
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    try {
      return await fn();
    } finally {
      try {
        fs.unlinkSync(this.lockFile);
      } catch {
        /* already gone */
      }
    }
  }
}
