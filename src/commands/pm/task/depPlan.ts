/** Pure helpers for `pm task dep`: the backend replaces a task's whole predecessor set, so add/remove are computed here. */

export interface Predecessor {
  taskId: number;
  dependencyType: string;
}

export const DEP_TYPES = ['finish_to_start', 'start_to_start'] as const;
export const DEFAULT_DEP_TYPE = 'finish_to_start';
/** Backend TaskDetailService.MAX_PREDECESSORS. */
export const MAX_PREDECESSORS = 50;

export function parseDepType(raw: string | undefined): string {
  if (raw === undefined) return DEFAULT_DEP_TYPE;
  if (!(DEP_TYPES as readonly string[]).includes(raw)) {
    throw new Error(`--type 只能是 ${DEP_TYPES.join(' | ')}，收到: ${raw}`);
  }
  return raw;
}

/** Adds `ids` (or changes their type if already present); order of existing predecessors is kept. */
export function addPredecessors(current: Predecessor[], ids: number[], type: string): { next: Predecessor[]; changed: boolean } {
  const next = current.map((p) => ({ ...p }));
  let changed = false;
  for (const id of ids) {
    const existing = next.find((p) => p.taskId === id);
    if (!existing) {
      next.push({ taskId: id, dependencyType: type });
      changed = true;
    } else if (existing.dependencyType !== type) {
      existing.dependencyType = type;
      changed = true;
    }
  }
  if (next.length > MAX_PREDECESSORS) {
    throw new Error(`前置任务最多 ${MAX_PREDECESSORS} 个，加上后会有 ${next.length} 个`);
  }
  return { next, changed };
}

/** Removes `ids`; `missing` lists the ones that were not predecessors so the caller can say so. */
export function removePredecessors(current: Predecessor[], ids: number[]): { next: Predecessor[]; missing: number[] } {
  const present = new Set(current.map((p) => p.taskId));
  return {
    next: current.filter((p) => !ids.includes(p.taskId)).map((p) => ({ ...p })),
    missing: ids.filter((id) => !present.has(id)),
  };
}
