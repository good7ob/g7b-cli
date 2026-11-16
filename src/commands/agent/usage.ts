/**
 * Token usage of a Claude Code session, read from its transcript (jsonl) and shaped for
 * `POST /progress/efforts` (source hook_trace). Used by the Stop hook and by the manual fallback.
 *
 * Why these rules:
 * - one API response is written once per content block with the same message.id → count each id once;
 * - usage is cumulative per session, and the backend overwrites by sessionId → re-uploading is safe;
 * - a session may span several tasks → only count messages since the task was claimed.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { dataDir } from '../../services/flavor';

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  modelCode?: string;
  startedAt?: number;
  endedAt?: number;
  workSeconds: number;
  messageCount: number;
}

/** Gaps longer than this are the human thinking / the agent idle, not work. */
const MAX_GAP_MS = 5 * 60_000;

export function parseTranscript(jsonl: string, sinceMs = 0): SessionUsage {
  const seen = new Set<string>();
  const out: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, workSeconds: 0, messageCount: 0 };
  const perModel = new Map<string, number>();
  let prev: number | undefined;
  let gapMs = 0;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // a half-written last line must not lose the rest
    }
    const ts = Date.parse(d?.timestamp);
    if (Number.isNaN(ts) || ts < sinceMs) continue;
    if (out.startedAt === undefined || ts < out.startedAt) out.startedAt = ts;
    if (out.endedAt === undefined || ts > out.endedAt) out.endedAt = ts;
    if (prev !== undefined && ts - prev <= MAX_GAP_MS) gapMs += Math.max(0, ts - prev);
    prev = ts;

    const m = d?.type === 'assistant' ? d.message : undefined;
    const u = m?.usage;
    if (!u) continue;
    const key = m.id ?? d.uuid;
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const input = Number(u.input_tokens) || 0;
    const output = Number(u.output_tokens) || 0;
    out.inputTokens += input;
    out.outputTokens += output;
    out.cacheReadTokens += Number(u.cache_read_input_tokens) || 0;
    out.cacheWriteTokens += Number(u.cache_creation_input_tokens) || 0;
    out.messageCount += 1;
    if (typeof m.model === 'string' && m.model !== '<synthetic>') perModel.set(m.model, (perModel.get(m.model) ?? 0) + input + output);
  }
  out.workSeconds = Math.round(gapMs / 1000);
  out.modelCode = [...perModel.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return out;
}

/** Same encoding Claude Code uses for ~/.claude/projects/<dir>: every non-alphanumeric becomes '-'. */
export const projectDirName = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-');

/** Newest transcript of the project at cwd — the fallback when the hook payload is not available. */
export function findLatestTranscript(cwd: string, home = os.homedir()): string | undefined {
  const dir = path.join(home, '.claude', 'projects', projectDirName(cwd));
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }));
  files.sort((a, b) => b.t - a.t);
  return files[0] ? path.join(dir, files[0].f) : undefined;
}

/** Task ids trace.sh recorded for this session: <cwd>/.claude/trace/<session>.summary.json → refs.tasks. */
export function traceTasks(cwd: string, sessionId: string): number[] {
  try {
    const f = path.join(cwd, '.claude', 'trace', `${sessionId}.summary.json`);
    const tasks = JSON.parse(fs.readFileSync(f, 'utf-8'))?.refs?.tasks;
    const ids = (Array.isArray(tasks) ? tasks : []).map((t: unknown) => Number(t)).filter((n) => Number.isInteger(n) && n > 0);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

export interface UsageTarget {
  taskId: number;
  sinceMs: number;
}

/**
 * Remember which task a session reported to. The Stop hook of the final turn runs after
 * `agent done` freed the slot, and that last turn's tokens still belong to the task.
 */
export class UsageMemo {
  constructor(private readonly dir: string = path.join(dataDir(), 'usage-hook')) {}
  private file(sessionId: string) {
    return path.join(this.dir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
  }
  read(sessionId: string): UsageTarget | undefined {
    try {
      const t = JSON.parse(fs.readFileSync(this.file(sessionId), 'utf-8'));
      return Number.isInteger(t?.taskId) && Number.isFinite(t?.sinceMs) ? t : undefined;
    } catch {
      return undefined;
    }
  }
  write(sessionId: string, target: UsageTarget): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(sessionId), JSON.stringify(target), 'utf-8');
  }
  log(msg: string): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(path.join(this.dir, 'hook.log'), `[${new Date().toISOString()}] ${msg}\n`, 'utf-8');
    } catch {
      /* logging must never break the hook */
    }
  }
}

/** Idempotency key: one row per (Claude session, task). */
export const usageSessionKey = (sessionId: string, taskId: number): string => `cc-${sessionId}-t${taskId}`;

/** Options for buildEffortBody (time.ts) — session key, tokens, model and times of the window. */
export function toEffortOptions(u: SessionUsage, taskId: number, sessionKey: string): Record<string, unknown> {
  const o: Record<string, unknown> = {
    task: [String(taskId)],
    sourceType: 'hook_trace',
    executorType: 'agent',
    agent: 'claude-code',
    sessionId: sessionKey,
    inputTokens: String(u.inputTokens),
    outputTokens: String(u.outputTokens),
    cacheReadTokens: String(u.cacheReadTokens),
    cacheWriteTokens: String(u.cacheWriteTokens),
    work: `${u.workSeconds}s`,
  };
  if (u.modelCode) o.model = u.modelCode;
  if (u.startedAt !== undefined) o.startedAt = String(u.startedAt);
  if (u.endedAt !== undefined) o.endedAt = String(u.endedAt);
  return o;
}

export const HOOK_COMMAND = 'good7ob agent report-usage --hook';

/** Add the Stop hook to a Claude Code settings object; idempotent. */
export function withStopHook(settings: any, command: string = HOOK_COMMAND): { settings: any; changed: boolean } {
  const next = { ...settings, hooks: { ...(settings?.hooks ?? {}) } };
  const stop: any[] = Array.isArray(next.hooks.Stop) ? [...next.hooks.Stop] : [];
  const has = stop.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h: any) => h?.command === command));
  if (has) return { settings, changed: false };
  stop.push({ hooks: [{ type: 'command', command, timeout: 30 }] });
  next.hooks.Stop = stop;
  return { settings: next, changed: true };
}
