/**
 * One round of the agent loop: reconcile the local slot with the backend, then
 * (if idle) claim the first claimable task. Shared by `listen` and `next`.
 */

import { extractRecords } from '../../utils/extractRecords';
import { AgentConfig } from './config';
import { ForwardTask } from './forward';
import { AgentState, AgentStateStore, BusyState, IDLE, RemoteStatus, advance, busyState } from './state';

export interface Api {
  get(url: string, params?: Record<string, any>): Promise<any>;
  post(url: string, data?: any): Promise<any>;
}

export interface RoundDeps {
  api: Api;
  store: AgentStateStore;
  cfg: AgentConfig;
  now?: () => number;
  log?: (msg: string) => void;
}

export type RoundResult =
  | { kind: 'busy'; state: AgentState }
  | { kind: 'empty' }
  | { kind: 'claimed'; state: BusyState; task: any }
  | { kind: 'forward_failed'; state: AgentState; task: any; error: string };

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 409 = someone else got it first / it is not in the expected state any more. */
export const isConflict = (e: any) => e?.code === 409 || e?.status === 409;

export function releaseTask(api: Api, taskId: number, reason: string): Promise<any> {
  return api.post(`/progress/tasks/${taskId}/release`, { reason });
}

export function toForwardTask(state: BusyState): ForwardTask {
  return {
    id: state.taskId,
    taskNo: state.taskNo,
    name: state.name,
    projectId: state.projectId,
    claimedAtMs: Date.parse(state.claimedAt),
  };
}

/** Advance the persisted slot (must run under the store lock). */
export async function reconcile(deps: RoundDeps): Promise<AgentState> {
  const { api, store, cfg } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const state = store.read();
  if (state.status === 'idle') return state;

  let remote: RemoteStatus = 'unknown';
  try {
    remote = (await api.get(`/progress/tasks/${state.taskId}`))?.status ?? 'unknown';
  } catch (e) {
    log(`查询任务 #${state.taskId} 状态失败（本地状态不变）: ${msgOf(e)}`);
  }

  const { state: next, action } = advance(state, now(), remote, cfg.graceMinutes);
  if (action === 'finished') log(`任务 #${state.taskId} 已是 ${remote}，释放本地工作槽`);
  if (action === 'release') {
    const minutes = Math.round((Date.parse(state.deadline) - Date.parse(state.claimedAt)) / 60_000);
    const reason = `超时疑似 agent 中断：领取于 ${state.claimedAt}，预计时长 ${minutes} 分钟，宽限 ${cfg.graceMinutes} 分钟后仍未完成`;
    try {
      const r = await releaseTask(api, state.taskId, reason);
      log(`任务 #${state.taskId} 已超时退回（${r?.status ?? '-'}，第 ${r?.releaseCount ?? '?'} 次）`);
    } catch (e) {
      if (!isConflict(e)) {
        // Keep the slot so the next round retries; going idle here would orphan an in_progress task.
        log(`任务 #${state.taskId} 超时退回失败，下一轮重试: ${msgOf(e)}`);
        const timedOut: AgentState = { ...state, status: 'timeout' };
        store.write(timedOut);
        return timedOut;
      }
      log(`任务 #${state.taskId} 已不在 in_progress，直接释放本地工作槽`);
    }
  }
  if (next !== state) store.write(next);
  return next;
}

async function claimNext(deps: RoundDeps): Promise<any | null> {
  const { api, cfg } = deps;
  const log = deps.log ?? (() => undefined);
  const params: Record<string, any> = {};
  if (cfg.projectId) params.projectId = cfg.projectId;
  const queue = extractRecords(await api.get('/progress/agent-tasks', params));
  for (const item of queue) {
    try {
      const claimed = await api.post(`/progress/tasks/${item.id}/claim`);
      return { ...item, ...(claimed || {}) };
    } catch (e) {
      log(isConflict(e) ? `任务 #${item.id} 已被领取，跳过` : `领取任务 #${item.id} 失败，跳过: ${msgOf(e)}`);
    }
  }
  return null;
}

/** `forward` given (listen): hand the claimed task over; on failure release it and free the slot. */
export async function runRound(
  deps: RoundDeps,
  forward?: (task: ForwardTask) => Promise<void>
): Promise<RoundResult> {
  const { api, store, cfg } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);

  const result = await store.withLock<RoundResult>(async () => {
    const state = await reconcile(deps);
    if (state.status !== 'idle') return { kind: 'busy', state };
    const task = await claimNext(deps);
    if (!task) return { kind: 'empty' };
    const busy = busyState(task, now(), cfg.expectedMinutes);
    store.write(busy);
    log(`已领取任务 #${task.id} ${task.taskNo ?? ''} ${task.name ?? ''}（截止 ${busy.deadline}）`);
    return { kind: 'claimed', state: busy, task };
  });

  if (result.kind !== 'claimed' || !forward) return result;
  const slot = result.state;
  try {
    await forward(toForwardTask(slot));
    log(`任务 #${slot.taskId} 已转交本机 agent`);
    return result;
  } catch (e) {
    const error = msgOf(e);
    log(`任务 #${slot.taskId} 转交失败: ${error}`);
    let freed = true;
    try {
      await releaseTask(api, slot.taskId, `转交本机 agent 失败: ${error}`);
    } catch (re) {
      // Not released: keep the slot busy so the timeout path releases it later instead of orphaning it.
      freed = isConflict(re);
      log(`任务 #${slot.taskId} 退回失败${freed ? '（已不在 in_progress）' : '，保留本地占用待超时后重试'}: ${msgOf(re)}`);
    }
    if (!freed) return { kind: 'forward_failed', state: slot, task: result.task, error };
    await store.withLock(async () => {
      const cur = store.read();
      if (cur.status !== 'idle' && cur.taskId === slot.taskId) store.write(IDLE);
    });
    return { kind: 'forward_failed', state: IDLE, task: result.task, error };
  }
}
