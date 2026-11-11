/**
 * AI self-built tasks inside a window-loop run (prd-0187 FP-7, api-0187 §5): the run context travels as the request
 * headers `X-Automation-Run-Id` / `X-Automation-Step-Id` (never in the body), the links as body fields
 * `functionPointId` / `rulePointId`, and the answer carries `data.spawnResult` (CREATED / DEDUPED / DRAFTED).
 */
import { InputError, parseId } from '../../../utils/cliHelpers';
import { AgentState, AgentStateStore } from '../../agent/state';

export const SPAWN_CONTEXT_INVALID = 'SPAWN_CONTEXT_INVALID';
export const RUN_HEADER = 'X-Automation-Run-Id';
export const STEP_HEADER = 'X-Automation-Step-Id';

export interface SpawnFlags {
  runId?: string;
  stepId?: string;
  fpId?: string;
  rpId?: string;
  /** commander's `--no-run-context` leaves `false` here; absent / true = read the agent slot */
  runContext?: boolean;
}

/** `--fp-id` / `--rp-id` → `functionPointId` / `rulePointId`. */
export function linkFields(o: SpawnFlags): Record<string, number> {
  const out: Record<string, number> = {};
  if (o.fpId !== undefined) out.functionPointId = parseId(o.fpId, '--fp-id');
  if (o.rpId !== undefined) out.rulePointId = parseId(o.rpId, '--rp-id');
  return out;
}

/** The step `agent listen` is working on right now, or undefined (idle / not a run step / unreadable file). */
function currentStep(readSlot: () => AgentState): { runId: number; stepId: number } | undefined {
  try {
    const s = readSlot();
    if (s.status === 'idle' || s.runId == null || s.stepId == null) return undefined;
    return { runId: s.runId, stepId: s.stepId };
  } catch (e) {
    console.error(`⚠ 读取 agent 状态文件失败，本次不带运行上下文：${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

/**
 * Headers for the create call. `--run-id` and `--step-id` go together; with neither, the step in the local agent
 * slot is used (none when idle, or with `--no-run-context`) and the call stays as it was.
 */
export function runContextHeaders(
  o: SpawnFlags,
  readSlot: () => AgentState = () => new AgentStateStore().read()
): Record<string, string> | undefined {
  if ((o.runId === undefined) !== (o.stepId === undefined)) {
    throw new InputError('--run-id 与 --step-id 必须同时给出（只给一个无法确定运行上下文）');
  }
  if (o.runId !== undefined && o.stepId !== undefined) {
    if (o.runContext === false) throw new InputError('--no-run-context 不能与 --run-id / --step-id 同时使用');
    return { [RUN_HEADER]: String(parseId(o.runId, '--run-id')), [STEP_HEADER]: String(parseId(o.stepId, '--step-id')) };
  }
  if (o.runContext === false) return undefined;
  const step = currentStep(readSlot);
  return step ? { [RUN_HEADER]: String(step.runId), [STEP_HEADER]: String(step.stepId) } : undefined;
}

/** The text for a guarded answer, or undefined when the answer has no `spawnResult` (human / no context: old output). */
export function renderSpawnResult(data: any, name: string): string | undefined {
  switch (data?.spawnResult) {
    case 'CREATED':
      return `✓ 已创建任务 #${data.id}: ${name}`;
    case 'DEDUPED':
      return `✓ 已存在任务 #${data.id}（去重）: ${data.name ?? name}`;
    case 'DRAFTED':
      return `✓ 已提交草案 #${data.draftId}（原因：${data.reason}）${data.draftExisted ? '；同键草案已存在' : ''}\n` +
        '  草案批准前不会有任务：good7ob automation draft approve <草案 ID>（仅人类 Key）';
    default:
      return undefined;
  }
}

/** 409 SPAWN_CONTEXT_INVALID (the body `code` is this string, so `.code` is not a number): a readable message. */
export function describeSpawnContextError(error: unknown): string | undefined {
  const e = error as { code?: unknown; message?: string } | null;
  if (e?.code !== SPAWN_CONTEXT_INVALID && !e?.message?.startsWith(`${SPAWN_CONTEXT_INVALID}:`)) return undefined;
  const reason = (e.message ?? '').replace(new RegExp(`^${SPAWN_CONTEXT_INVALID}:?\\s*`), '');
  return `运行上下文无效（SPAWN_CONTEXT_INVALID）：${reason || '步骤不属于该 AI 员工、不是窗口长 Run 的步骤，或步骤已结束'}。` +
    '任务未创建，也没有草案。检查 --run-id / --step-id 与 agent 当前步骤；不想带上下文可加 --no-run-context';
}
