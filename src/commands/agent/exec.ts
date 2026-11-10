/**
 * `good7ob agent start / end` — occupy a task for one agent session (prd-0071 rp-pm-agent-0041..0055,
 * backend api-agent-exec-lease). The backend keeps a Redis lease per task so two windows of the same user
 * cannot work it at once, and sums the execution time.
 *
 * Business failures arrive as HTTP 200 + body.code; ApiClient turns them into an Error carrying `code` and
 * `payload`, so a 409 holder is read from `payload.data.holder`.
 */

import { InputError, fmtDateTime } from '../../utils/cliHelpers';

export const SESSION_ENV = 'G7B_SESSION_ID';
/** Same shape the backend accepts (ExecIdentity.SESSION_SHAPE); anything else is a 1001 there. */
const SESSION_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;
/** Somebody else holds the task (409), like `agent next`'s "slot busy". */
export const EXIT_HELD = 3;

export interface ExecHolder {
  display?: string | null;
  startedAt?: number | null;
}

/** `--session` wins over `G7B_SESSION_ID`; blank = none. */
export function resolveSessionId(opt: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = (opt ?? env[SESSION_ENV] ?? '').trim();
  if (!value) return undefined;
  if (!SESSION_SHAPE.test(value)) throw new InputError('sessionId 只能含字母、数字、- 和 _，长度 1~128');
  return value;
}

export function requireSessionId(opt: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const id = resolveSessionId(opt, env);
  if (!id) throw new InputError(`缺少会话 ID：用 --session <uuid> 指定，或设置环境变量 ${SESSION_ENV}`);
  return id;
}

export function fmtSeconds(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return [h ? `${h} 小时` : '', h || m ? `${m} 分` : '', `${s} 秒`].filter(Boolean).join(' ');
}

export function startBody(sessionId: string) {
  return { sessionId };
}

export function endBody(sessionId: string | undefined, force: boolean) {
  return { ...(sessionId ? { sessionId } : {}), ...(force ? { force: true } : {}) };
}

export const execPath = (taskId: number, action: 'start' | 'end') => `/progress/tasks/${taskId}/agent-exec/${action}`;

export function describeStart(r: any): string {
  if (!r?.enforced) {
    return `! 任务 #${r?.taskId} 的执行占用未启用（后端开关关闭或占用存储不可用）：不做互斥，也不计时`;
  }
  const verb = r.renewed ? '执行占用已续期' : '已开始执行';
  return `✓ 任务 #${r.taskId} ${verb}（${r.subStatus ?? '-'}）\n  执行者: ${r.display ?? '-'}  开始: ${fmtDateTime(r.startedAt)}`;
}

export function describeEnd(r: any): string {
  if (!r?.endReason) return `任务 #${r?.taskId} 当前没有执行占用，无需结束`;
  const why = r.endReason === 'FORCE' ? '（强制释放）' : '';
  return `✓ 任务 #${r.taskId} 已结束执行${why}\n  本次: ${fmtSeconds(r.durationSeconds)}  累计: ${fmtSeconds(r.agentExecSeconds)}`;
}

/** The 409 holder of an AgentExecConflictException, or null for any other error. */
export function holderOf(e: any): ExecHolder | null {
  if (e?.code !== 409 && e?.status !== 409) return null;
  return e?.payload?.data?.holder ?? null;
}

export function describeConflict(e: any, holder: ExecHolder, hintForce: boolean): string {
  const lines = [`✗ ${e.message}`, `  占用者: ${holder.display ?? '-'}  开始: ${fmtDateTime(holder.startedAt)}`];
  if (hintForce) lines.push('  如确需接管，加 --force 强制释放（仅任务负责人或项目管理员）');
  return lines.join('\n');
}
