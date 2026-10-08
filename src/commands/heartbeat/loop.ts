/**
 * Heartbeat loop for `good7ob heartbeat`. Pure of I/O (everything comes in through LoopDeps) so the
 * stop conditions are unit-testable: the loop ends when the agent process is gone, or when the
 * backend says this key can never heartbeat.
 */

/** ok: stored; retry: transient (network / 5xx / Redis hiccup), keep going; fatal: bad key, stop. */
export type BeatResult = 'ok' | 'retry' | 'fatal';

export interface LoopDeps {
  beat: () => Promise<BeatResult>;
  agentAlive: () => boolean;
  sleep: (ms: number) => Promise<void>;
  intervalMs: number;
}

export type LoopEnd = 'agent-gone' | 'fatal';

export async function runLoop(deps: LoopDeps): Promise<LoopEnd> {
  while (deps.agentAlive()) {
    if ((await deps.beat()) === 'fatal') return 'fatal';
    await deps.sleep(deps.intervalMs);
  }
  return 'agent-gone';
}
