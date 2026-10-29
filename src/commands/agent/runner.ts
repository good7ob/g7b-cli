/**
 * Runner identity, registration and heartbeat payloads for `good7ob agent listen` / `good7ob heartbeat`
 * (prd-0136 FP-2, rp-auto-sched-0009 ~ 0014; backend `AutomationRunnerController` / `RunnerPort.RunnerBeat`).
 *
 * The backend keys a runner on (employee from the key, `runnerKey`), so registering twice from the same
 * machine updates the row instead of duplicating it.
 */

import * as os from 'os';
import * as path from 'path';
import { InputError } from '../../utils/cliHelpers';
import { RunnerRegistration } from './state';

export const REGISTER_PATH = '/api/v1/me/runners';
export const HEARTBEAT_PATH = '/api/v1/me/heartbeat';

export const ENV_TAGS = ['dev', 'test', 'prod'] as const;
export const MIN_SLOTS = 1;
export const MAX_SLOTS = 8;
export const DEFAULT_AGENT_KIND = 'CLAUDE_CODE';
const MAX_RUNNER_KEY = 128;

/** 1..8 (backend `AutomationRunnerService.MIN_SLOTS / MAX_SLOTS`). */
export function parseSlots(raw: string | number | undefined, label = '--slots'): number {
  const text = String(raw ?? '').trim();
  if (!/^[0-9]+$/.test(text)) throw new InputError(`${label} 必须是 ${MIN_SLOTS}~${MAX_SLOTS} 的整数，收到: ${raw}`);
  const n = parseInt(text, 10);
  if (n < MIN_SLOTS || n > MAX_SLOTS) throw new InputError(`${label} 必须在 ${MIN_SLOTS} 到 ${MAX_SLOTS} 之间，收到: ${n}`);
  return n;
}

/** `dev,test` -> ['dev','test']: lower-cased, de-duplicated, subset of dev / test / prod. '' -> []. */
export function parseEnvTags(raw: string | undefined, label = '--env'): string[] {
  const tags = Array.from(
    new Set(
      String(raw ?? '')
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    )
  );
  const bad = tags.filter((t) => !(ENV_TAGS as readonly string[]).includes(t));
  if (bad.length) throw new InputError(`${label} 只能取 ${ENV_TAGS.join(' / ')}，收到: ${bad.join(', ')}`);
  return tags;
}

/** `agent_type.code` style: upper-cased, 2-30 chars of A-Z / 0-9 / _ (CLAUDE_CODE, CODEX, GEMINI_CLI, CUSTOM, ...). */
export function normalizeAgentKind(raw: string, label = '--agent-kind'): string {
  const code = String(raw).trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(code)) {
    throw new InputError(`${label} 必须是 2~30 位的字母/数字/下划线代码（如 CLAUDE_CODE、CODEX），收到: ${raw}`);
  }
  return code;
}

/** Host id as the backend `runnerKey`: 1-128 visible chars, no whitespace. Default = hostname. */
export function normalizeHostId(raw: string | undefined, label = '--host-id'): string {
  const id = (raw ?? os.hostname()).trim();
  if (!id || id.length > MAX_RUNNER_KEY || /\s/.test(id)) {
    throw new InputError(`${label} 必须是 1~${MAX_RUNNER_KEY} 个非空白字符，收到: ${raw}`);
  }
  return id;
}

export interface RunnerOptions {
  slots: number;
  envTags: string[];
  agentKind: string;
  hostId: string;
  hostLabel: string;
}

/** Flags win over `agent.*` config, config over the defaults (slots 1, no env, CLAUDE_CODE, hostname). */
export function resolveRunnerOptions(
  flags: { slots?: string; env?: string; agentKind?: string; hostId?: string },
  cfg: { slots?: number; envTags?: string[]; agentKind?: string; hostId?: string } = {},
  cwd = process.cwd()
): RunnerOptions {
  return {
    slots: flags.slots !== undefined ? parseSlots(flags.slots) : cfg.slots ?? MIN_SLOTS,
    envTags: flags.env !== undefined ? parseEnvTags(flags.env) : cfg.envTags ?? [],
    agentKind: flags.agentKind !== undefined ? normalizeAgentKind(flags.agentKind) : cfg.agentKind ?? DEFAULT_AGENT_KIND,
    hostId: normalizeHostId(flags.hostId ?? cfg.hostId),
    hostLabel: `${os.hostname()}:${path.basename(cwd)}`,
  };
}

/** Body of `POST /api/v1/me/runners` (backend `RegisterRunnerDto`). */
export function registerPayload(o: RunnerOptions): Record<string, unknown> {
  return { runnerKey: o.hostId, hostLabel: o.hostLabel, agentKind: o.agentKind, slots: o.slots, envTags: o.envTags };
}

/** Runner fields a heartbeat may carry (all optional on the wire; nothing -> plain employee heartbeat). */
export interface HeartbeatRunner {
  runnerId?: number;
  runnerKey?: string;
  slots?: number;
  envTags?: string[];
}

/**
 * Body of `POST /api/v1/me/heartbeat`: `runnerId` (design n4 §5.2) and `runnerKey` (backend `RunnerPort.RunnerBeat`)
 * are both sent so either server build identifies the runner; `slots` / `envTags` only when they should change.
 * `undefined` when there is nothing to say beyond "the employee is alive" (rp-auto-sched-0010).
 */
export function heartbeatPayload(r?: HeartbeatRunner): Record<string, unknown> | undefined {
  if (!r || (r.runnerId == null && !r.runnerKey)) return undefined;
  const body: Record<string, unknown> = {};
  if (r.runnerId != null) body.runnerId = r.runnerId;
  if (r.runnerKey) body.runnerKey = r.runnerKey;
  if (r.slots != null) body.slots = r.slots;
  if (r.envTags) body.envTags = r.envTags;
  return body;
}

/** `DELETE /api/v1/me/heartbeat?runnerKey=&runnerId=`: takes this runner offline and frees its unclaimed leases. */
export function offlinePath(r?: HeartbeatRunner): string {
  const q = new URLSearchParams();
  if (r?.runnerKey) q.set('runnerKey', r.runnerKey);
  if (r?.runnerId != null) q.set('runnerId', String(r.runnerId));
  const qs = q.toString();
  return qs ? `${HEARTBEAT_PATH}?${qs}` : HEARTBEAT_PATH;
}

/** `stopStepIds` out of a heartbeat answer (`{ stopStepIds: [..] }`), tolerant of an empty / legacy body. */
export function stopStepIdsOf(data: unknown): number[] {
  const ids = (data as { stopStepIds?: unknown } | null)?.stopStepIds;
  return Array.isArray(ids) ? ids.map(Number).filter((n) => Number.isFinite(n)) : [];
}

/** Registration record from the backend answer (`RunnerVo`: `id`, or `runnerId` per the design doc). */
export function toRegistration(data: any, o: RunnerOptions, nowMs = Date.now()): RunnerRegistration {
  const runnerId = Number(data?.runnerId ?? data?.id);
  if (!Number.isFinite(runnerId) || runnerId <= 0) {
    throw new Error(`注册响应缺少 runnerId: ${JSON.stringify(data ?? null)}`);
  }
  return {
    runnerId,
    runnerKey: typeof data?.hostKey === 'string' && data.hostKey ? data.hostKey : o.hostId,
    hostLabel: o.hostLabel,
    slots: Number.isFinite(Number(data?.slots)) && data?.slots != null ? Number(data.slots) : o.slots,
    envTags: Array.isArray(data?.envTags) ? data.envTags.map(String) : o.envTags,
    agentKind: typeof data?.agentKind === 'string' && data.agentKind ? data.agentKind : o.agentKind,
    registeredAt: new Date(nowMs).toISOString(),
  };
}

export const NOT_EMPLOYEE_HINT = '仅 AI 员工';

/** Registration / heartbeat answers that no retry will fix (bad key, human key, backend without the endpoint). */
export function isFatalAuth(e: unknown): boolean {
  const status = (e as { status?: number; code?: number }).status;
  const code = (e as { code?: number }).code;
  const message = e instanceof Error ? e.message : String(e);
  return [401, 403, 404].includes(status as number) || [401, 403, 404, 2718].includes(code as number) || message.includes(NOT_EMPLOYEE_HINT);
}

/** prd-0136 rp-auto-sched-0042: `409 ASSIGNED_TO_OTHER` (backend) / `2716` (design doc). */
export function isAssignedToOther(e: unknown): boolean {
  const code = (e as { code?: number }).code;
  const message = e instanceof Error ? e.message : String(e);
  return code === 2716 || /ASSIGNED_TO_OTHER/.test(message) || /已分配给/.test(message);
}

/** `400 JOB_MISMATCH`: this employee lacks the node's job; the task will never be ours. */
export function isJobMismatch(e: unknown): boolean {
  const code = (e as { code?: number }).code;
  const message = e instanceof Error ? e.message : String(e);
  return code === 2713 || /JOB_MISMATCH/.test(message);
}

/** A queue item the scheduler assigned to the caller (`AgentQueueItemVo.isAssigned` serialises as `assigned`). */
export function isAssignedItem(item: any): boolean {
  return !!item && (item.assignmentId != null || item.assigned === true || item.isAssigned === true);
}

/** Assigned-work context for terminal output: run / step / node and the node brief. */
export function describeAssignment(item: any, indent = '  '): string {
  if (!isAssignedItem(item)) return '';
  const head = [
    item.assignmentId != null ? `分配 #${item.assignmentId}` : '已分配',
    item.runId != null ? `运行 #${item.runId}` : null,
    item.stepId != null ? `步骤 #${item.stepId}` : null,
    item.nodeCode ? `节点 ${item.nodeCode}${item.requiredJob ? `（岗位 ${item.requiredJob}）` : ''}` : null,
    item.leaseUntil != null ? `租约至 ${fmtLease(item.leaseUntil)}` : null,
  ]
    .filter(Boolean)
    .join('  ');
  const lines = [`${indent}${head}`];
  if (item.nodePrompt) lines.push(`${indent}节点提示: ${String(item.nodePrompt).trim()}`);
  if (item.nodeExpectedOutput) lines.push(`${indent}期望产出: ${String(item.nodeExpectedOutput).trim()}`);
  if (Array.isArray(item.nodeExitChecklist) && item.nodeExitChecklist.length) {
    lines.push(`${indent}完成清单: ${item.nodeExitChecklist.map(String).join('；')}`);
  }
  return lines.join('\n');
}

function fmtLease(v: unknown): string {
  if (typeof v === 'number') return new Date(v).toISOString();
  return String(v);
}

export function describeRunner(r: RunnerRegistration | null): string {
  if (!r) return '未注册（agent listen 启动时注册）';
  return [
    `Runner #${r.runnerId}  ${r.hostLabel}（hostId ${r.runnerKey}）`,
    `  slots: ${r.slots}  env: ${r.envTags.length ? r.envTags.join(',') : '(无)'}  agentKind: ${r.agentKind}  注册于: ${r.registeredAt}`,
  ].join('\n');
}
