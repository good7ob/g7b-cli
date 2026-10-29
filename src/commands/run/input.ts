/**
 * Pure parts of `good7ob run` (prd-0137 FP-3 / FP-4 / FP-6, design n3 §4 / §7, backend #992 `RunDtos`):
 * which run / step a report goes to, log chunking + masking, `git diff` parsing, tool-call JSONL, artifact refs,
 * request bodies and the 27xx error messages. No I/O here, so every rule is unit-tested directly.
 */

import { AgentState } from '../agent/state';
import { InputError, parseId } from '../../utils/cliHelpers';

// ── run / step resolution ──

export interface StepTarget {
  runId: number;
  stepId: number;
  /** The target is the step the local work slot holds: seq counter, org and slot clearing apply. */
  fromSlot: boolean;
  /** Org carried by the slot (when the claimed task had one). */
  orgId?: number;
}

/**
 * `--run` / `--step` win; missing ones come from the busy local slot (`agent listen` / `agent next` claimed an
 * assigned item). A `--step` other than the slot's needs its `--run`; a slot without a step is not a run step.
 */
export function resolveTarget(opts: { run?: string; step?: string }, slot: AgentState): StepTarget {
  const run = opts.run !== undefined ? parseId(opts.run, '--run') : undefined;
  const step = opts.step !== undefined ? parseId(opts.step, '--step') : undefined;
  const held = slot.status !== 'idle' && slot.stepId != null && slot.runId != null ? slot : null;
  if (step === undefined && run === undefined) {
    if (!held) {
      throw new InputError(
        '缺少 --run / --step：本地工作槽没有运行步骤（只有 agent listen / agent next 领取的调度分配才带运行步骤），请显式传 --run <id> --step <id>'
      );
    }
    return withOrg({ runId: held.runId as number, stepId: held.stepId as number, fromSlot: true }, held.orgId);
  }
  if (step === undefined) {
    if (held && held.runId === run) return withOrg({ runId: run, stepId: held.stepId as number, fromSlot: true }, held.orgId);
    throw new InputError(`缺少 --step：运行 #${run} 不是本地工作槽正在执行的运行，请同时给出 --step <id>`);
  }
  if (run === undefined) {
    if (held && held.stepId === step) return withOrg({ runId: held.runId as number, stepId: step, fromSlot: true }, held.orgId);
    throw new InputError(`缺少 --run：步骤 #${step} 不是本地工作槽正在执行的步骤，请同时给出 --run <id>`);
  }
  const fromSlot = !!held && held.runId === run && held.stepId === step;
  return withOrg({ runId: run, stepId: step, fromSlot }, fromSlot ? held?.orgId : undefined);
}

function withOrg(t: StepTarget, orgId: number | null | undefined): StepTarget {
  return orgId != null ? { ...t, orgId } : t;
}

export const runBase = (orgId: number) => `/api/v1/orgs/${orgId}/runs`;
export const stepBase = (orgId: number, t: { runId: number; stepId: number }) => `${runBase(orgId)}/${t.runId}/steps/${t.stepId}`;

// ── masking (rp-auto-run-0021 / 0027: the runner masks before anything leaves the machine) ──

const MASK = '***';
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, `-----BEGIN PRIVATE KEY-----${MASK}-----END PRIVATE KEY-----`],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, MASK],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, MASK],
  [/\bg7b_[A-Za-z0-9_-]{16,}/g, MASK],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, MASK],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, MASK],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, MASK],
  [/(:\/\/[^\s:/@]+:)[^\s@/]+@/g, `$1${MASK}@`],
  // key=value / key: value / "key": "value" for the usual secret names
  [
    /((?:api[_-]?key|apikey|access[_-]?key|secret(?:[_-]?key)?|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|pwd|private[_-]?key|x-api-key)["']?\s*[:=]\s*["']?)([^\s"',;&]{3,})/gi,
    `$1${MASK}`,
  ],
];

/** Masks keys, tokens, passwords, private keys and URL credentials with `***`. */
export function maskSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

// ── log chunking (≤ 1 MB per segment, backend `RunDataService.SEGMENT_MAX`) ──

export const SEGMENT_MAX = 1024 * 1024;
export const STEP_LOG_CAP = 50 * 1024 * 1024;

/**
 * Splits UTF-8 text into segments of at most `max` bytes, never inside a character; a cut prefers the last line
 * break in the second half of the window so a line is not split when it can be avoided.
 */
export function chunkLog(text: string, max = SEGMENT_MAX): string[] {
  const buf = Buffer.from(text, 'utf-8');
  if (buf.length === 0) return [];
  const out: string[] = [];
  let start = 0;
  while (start < buf.length) {
    let end = Math.min(start + max, buf.length);
    if (end < buf.length) {
      const nl = buf.lastIndexOf(0x0a, end - 1);
      if (nl >= start + Math.floor(max / 2)) {
        end = nl + 1;
      } else {
        while (end > start && (buf[end] & 0xc0) === 0x80) end--; // continuation byte: step back to a char start
      }
    }
    out.push(buf.subarray(start, end).toString('utf-8'));
    start = end;
  }
  return out;
}

/** `--seq`: a positive integer (backend: seq from 1). */
export function parseSeq(raw: string | undefined): number | undefined {
  return raw === undefined ? undefined : parseId(raw, '--seq');
}

/** Body of `POST …/logs` as JSON (backend `RunDtos.LogChunk`). */
export function logChunkBody(seq: number, content: string): { seq: number; content: string } {
  return { seq, content };
}

// ── git diff summary (rp-auto-run-0023: paths and line counts only, never content) ──

export interface FileItem {
  path: string;
  changeType: 'A' | 'M' | 'D' | 'R';
  linesAdded: number;
  linesDeleted: number;
  oldPath?: string;
  prUrl?: string;
}

export const FILES_MAX = 2000;

/**
 * `git diff --numstat -z -M`: `added\tdeleted\tpath\0`, or for a rename `added\tdeleted\t\0old\0new\0`;
 * binary files show `-` (counted as 0).
 */
export function parseNumstatZ(out: string): Array<{ path: string; oldPath?: string; added: number; deleted: number }> {
  const parts = out.split('\0');
  const rows: Array<{ path: string; oldPath?: string; added: number; deleted: number }> = [];
  for (let i = 0; i < parts.length; i++) {
    const head = parts[i];
    if (!head) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(head);
    if (!m) continue;
    const added = m[1] === '-' ? 0 : parseInt(m[1], 10);
    const deleted = m[2] === '-' ? 0 : parseInt(m[2], 10);
    if (m[3] === '') {
      const oldPath = parts[++i];
      const path = parts[++i];
      if (path) rows.push({ path, oldPath, added, deleted });
    } else {
      rows.push({ path: m[3], added, deleted });
    }
  }
  return rows;
}

/** `git diff --name-status -z -M`: `X\0path\0`, renames / copies `R100\0old\0new\0`. Map path → change type. */
export function parseNameStatusZ(out: string): Map<string, 'A' | 'M' | 'D' | 'R'> {
  const parts = out.split('\0');
  const types = new Map<string, 'A' | 'M' | 'D' | 'R'>();
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i];
    if (!status) continue;
    const letter = status[0];
    if (letter === 'R' || letter === 'C') {
      i++; // old path
      const path = parts[++i];
      if (path) types.set(path, letter === 'R' ? 'R' : 'A');
    } else {
      const path = parts[++i];
      if (path) types.set(path, letter === 'A' ? 'A' : letter === 'D' ? 'D' : 'M');
    }
  }
  return types;
}

/** Joins the two git outputs into the backend's `FileItem` rows (renames keep `oldPath`). */
export function diffSummary(numstatZ: string, nameStatusZ: string, prUrl?: string): FileItem[] {
  const types = parseNameStatusZ(nameStatusZ);
  return parseNumstatZ(numstatZ).map((r) => {
    const item: FileItem = {
      path: r.path,
      changeType: r.oldPath ? 'R' : types.get(r.path) ?? 'M',
      linesAdded: r.added,
      linesDeleted: r.deleted,
    };
    if (r.oldPath) item.oldPath = r.oldPath;
    if (prUrl) item.prUrl = prUrl;
    return item;
  });
}

/** `--files <json|@file>` content: an array of `{path, changeType?, linesAdded?, linesDeleted?, oldPath?, prUrl?}`. */
export function parseFilesJson(text: string, label = '--files'): FileItem[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new InputError(`${label} 不是合法 JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(data)) throw new InputError(`${label} 必须是数组 [{path, changeType, linesAdded, linesDeleted}]`);
  return data.map((f: any, i) => {
    if (!f || typeof f.path !== 'string' || !f.path.trim()) throw new InputError(`${label}[${i}].path 不能为空`);
    const ct = String(f.changeType ?? 'M').trim().toUpperCase()[0];
    if (!['A', 'M', 'D', 'R'].includes(ct)) throw new InputError(`${label}[${i}].changeType 只能是 A / M / D / R`);
    const item: FileItem = {
      path: f.path.trim(),
      changeType: ct as FileItem['changeType'],
      linesAdded: nonNegative(f.linesAdded ?? f.added, `${label}[${i}].linesAdded`),
      linesDeleted: nonNegative(f.linesDeleted ?? f.deleted, `${label}[${i}].linesDeleted`),
    };
    if (f.oldPath) item.oldPath = String(f.oldPath);
    if (f.prUrl) item.prUrl = String(f.prUrl);
    return item;
  });
}

function nonNegative(v: unknown, label: string): number {
  if (v === undefined || v === null) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new InputError(`${label} 必须是非负整数，收到: ${v}`);
  return n;
}

// ── tool calls (rp-auto-run-0026 / 0027) ──

export interface ToolCallItem {
  toolName: string;
  startedAt: string;
  durationMs: number;
  result: 'ok' | 'error';
  summary?: string;
}

export const TOOL_CALLS_PER_CALL = 500;

/**
 * One JSON object per line: `{tool, startedAt, durationMs, ok, note}` (the backend names `toolName / result /
 * summary` are accepted too). Blank lines are skipped; the note is masked and cut to 200 characters.
 */
export function parseToolCallsJsonl(text: string): ToolCallItem[] {
  const items: ToolCallItem[] = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    if (!line.trim()) return;
    const where = `第 ${idx + 1} 行`;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch (e) {
      throw new InputError(`${where} 不是合法 JSON: ${(e as Error).message}`);
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new InputError(`${where} 必须是 JSON 对象`);
    const tool = String(o.tool ?? o.toolName ?? '').trim();
    if (!tool) throw new InputError(`${where} 缺少 tool`);
    const startedAt = String(o.startedAt ?? '').trim();
    if (!startedAt || Number.isNaN(Date.parse(startedAt))) throw new InputError(`${where} startedAt 不是 ISO 时间: ${o.startedAt}`);
    const durationMs = Number(o.durationMs ?? 0);
    if (!Number.isInteger(durationMs) || durationMs < 0) throw new InputError(`${where} durationMs 必须是非负整数: ${o.durationMs}`);
    let result: 'ok' | 'error';
    if (typeof o.ok === 'boolean') result = o.ok ? 'ok' : 'error';
    else if (o.result === 'ok' || o.result === 'error') result = o.result;
    else if (o.ok === undefined && o.result === undefined) result = 'ok';
    else throw new InputError(`${where} ok 必须是 true / false（或 result: ok|error）`);
    const note = o.note ?? o.summary;
    const item: ToolCallItem = { toolName: tool.slice(0, 60), startedAt, durationMs, result };
    if (note !== undefined && note !== null && String(note).trim()) item.summary = maskSecrets(String(note).trim()).slice(0, 200);
    items.push(item);
  });
  return items;
}

/** Batches of at most `size` (backend: ≤ 500 per call). */
export function batches<T>(items: T[], size = TOOL_CALLS_PER_CALL): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── artifacts (closed set, backend `AutoRunStepArtifact.TYPES`; 2727 otherwise) ──

export const ARTIFACT_TYPES = [
  'PULL_REQUEST', 'REVIEW_REPORT', 'TEST_RUN', 'EXTERNAL', 'DELIVERABLE_PACKAGE', 'GATE_RESULT', 'ACCEPTANCE_RECORD', 'RELEASE', 'DEPLOY_RECORD',
] as const;
const ARTIFACT_ALIASES: Record<string, string> = { PR: 'PULL_REQUEST' };

export interface ArtifactItem {
  type: string;
  id?: number;
  url?: string;
  title?: string;
}

export function parseArtifactType(raw: string): string {
  const t = String(raw ?? '').trim().toUpperCase().replace(/-/g, '_');
  const type = ARTIFACT_ALIASES[t] ?? t;
  if (!(ARTIFACT_TYPES as readonly string[]).includes(type)) {
    throw new InputError(`--type 取值无效: ${raw}（可选: PR | ${ARTIFACT_TYPES.join(' | ')}）`);
  }
  return type;
}

/** `--ref`: a positive integer = the object id, an http(s) URL = an external link. */
export function artifactItem(type: string, ref: string, title?: string): ArtifactItem {
  const t = parseArtifactType(type);
  const r = String(ref ?? '').trim();
  const item: ArtifactItem = { type: t };
  if (/^[1-9][0-9]*$/.test(r)) item.id = parseId(r, '--ref');
  else if (/^https?:\/\/\S+$/i.test(r)) item.url = r;
  else throw new InputError(`--ref 必须是对象 id（正整数）或 http(s) 链接，收到: ${ref}`);
  if (title !== undefined && title.trim()) item.title = title.trim().slice(0, 200);
  return item;
}

/** `--artifact <type>:<ref>` (design n3 §7), e.g. `TEST_RUN:7`, `EXTERNAL:https://…`. */
export function parseArtifactSpec(spec: string): ArtifactItem {
  const i = spec.indexOf(':');
  if (i <= 0) throw new InputError(`--artifact 格式为 <type>:<id|url>，收到: ${spec}`);
  return artifactItem(spec.slice(0, i), spec.slice(i + 1));
}

// ── done / fail bodies (backend `RunDtos.DoneReport` / `FailReport`) ──

export interface TokenReport {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * `--tokens`: a JSON object `{input, output, cacheRead, cacheWrite}`, or a single integer = the step total,
 * reported as `input` (the backend has no total field; work records win over self-reported tokens anyway).
 */
export function parseTokens(raw: string | undefined): TokenReport | undefined {
  if (raw === undefined) return undefined;
  const text = raw.trim();
  if (/^[0-9]+$/.test(text)) return { input: parseInt(text, 10) };
  let o: any;
  try {
    o = JSON.parse(text);
  } catch {
    throw new InputError(`--tokens 必须是非负整数或 JSON {"input":…,"output":…,"cacheRead":…,"cacheWrite":…}，收到: ${raw}`);
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new InputError('--tokens 的 JSON 必须是对象');
  const out: TokenReport = {};
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
    if (o[k] !== undefined) out[k] = nonNegative(o[k], `--tokens.${k}`);
  }
  const unknown = Object.keys(o).filter((k) => !['input', 'output', 'cacheRead', 'cacheWrite'].includes(k));
  if (unknown.length) throw new InputError(`--tokens 只能包含 input / output / cacheRead / cacheWrite，多余: ${unknown.join(', ')}`);
  return out;
}

export const SUMMARY_MAX = 500;
export const RESULTS = ['completed', 'partial'] as const;
const PARTIAL_PREFIX = '[partial] ';

export interface DoneFlags {
  summary?: string;
  result?: string;
  pr?: string[];
  tokens?: string;
  artifact?: string[];
  branch?: string;
  commitRange?: string;
}

/**
 * `POST …/done` body. `--result partial` has no backend field: it is kept visible as a `[partial] ` prefix of the
 * summary (the step still succeeds — use `run step fail` when the work cannot continue).
 */
export function doneBody(f: DoneFlags, files?: FileItem[]): Record<string, unknown> {
  const result = (f.result ?? 'completed').trim().toLowerCase();
  if (!(RESULTS as readonly string[]).includes(result)) throw new InputError(`--result 取值无效: ${f.result}（可选: ${RESULTS.join(' | ')}）`);
  const body: Record<string, unknown> = {};
  let summary = f.summary?.trim();
  if (result === 'partial') summary = `${PARTIAL_PREFIX}${summary ?? ''}`.trim();
  if (summary) {
    if (summary.length > SUMMARY_MAX) throw new InputError(`--summary 最多 ${SUMMARY_MAX} 个字符，当前 ${summary.length} 个`);
    body.summary = maskSecrets(summary);
  }
  const prs = (f.pr ?? []).map((u) => u.trim()).filter(Boolean);
  prs.forEach((u) => {
    if (!/^https?:\/\/\S+$/i.test(u)) throw new InputError(`--pr 必须是 http(s) 链接，收到: ${u}`);
  });
  if (prs.length) body.prUrls = prs;
  const artifacts = (f.artifact ?? []).map(parseArtifactSpec);
  if (artifacts.length) body.artifacts = artifacts;
  const tokens = parseTokens(f.tokens);
  if (tokens) body.tokens = tokens;
  if (f.branch?.trim()) body.branch = f.branch.trim();
  if (f.commitRange?.trim()) body.commitRange = f.commitRange.trim();
  if (files && files.length) body.files = files;
  return body;
}

export const FAIL_CODES = ['TEST_FAILED', 'REVIEW_FAILED', 'AGENT_ERROR', 'BLOCKED', 'OTHER'] as const;

export interface FailFlags {
  reason?: string;
  message?: string;
  code?: string;
  retryable?: boolean;
  tokens?: string;
  artifact?: string[];
}

/**
 * `POST …/fail` body `{reason: <code>, message}`. `--reason` is the human text; the code comes from `--code`,
 * or `--reason` itself when it is one of the codes (design n3 §7 form `--reason TEST_FAILED --message …`), else
 * `--retryable` → `AGENT_ERROR` (transient: a human `run step retry` makes sense) and otherwise `OTHER`.
 * TEST_FAILED / REVIEW_FAILED send the work back to the node's `onFailureGoTo` on the backend.
 */
export function failBody(f: FailFlags): Record<string, unknown> {
  const text = f.reason?.trim();
  if (!text) throw new InputError('--reason 不能为空');
  const asCode = text.toUpperCase();
  let code: string;
  let message: string | undefined;
  if (f.code !== undefined) {
    code = f.code.trim().toUpperCase();
    message = f.message?.trim() || text;
  } else if ((FAIL_CODES as readonly string[]).includes(asCode)) {
    code = asCode;
    message = f.message?.trim();
  } else {
    code = f.retryable ? 'AGENT_ERROR' : 'OTHER';
    message = f.message?.trim() ? `${text}：${f.message.trim()}` : text;
  }
  if (!(FAIL_CODES as readonly string[]).includes(code)) throw new InputError(`--code 取值无效: ${f.code}（可选: ${FAIL_CODES.join(' | ')}）`);
  const body: Record<string, unknown> = { reason: code };
  if (message) {
    if (message.length > SUMMARY_MAX) throw new InputError(`失败说明最多 ${SUMMARY_MAX} 个字符，当前 ${message.length} 个`);
    body.message = maskSecrets(message);
  }
  const artifacts = (f.artifact ?? []).map(parseArtifactSpec);
  if (artifacts.length) body.artifacts = artifacts;
  const tokens = parseTokens(f.tokens);
  if (tokens) body.tokens = tokens;
  return body;
}

// ── human side ──

export const RUN_STATUSES = ['queued', 'running', 'paused', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'] as const;
export const OPERATIONS = ['pause', 'resume', 'halt', 'cancel', 'abandon'] as const;
export type Operation = (typeof OPERATIONS)[number];

/** `{version, reason?}`; cancel / abandon need a reason (backend: 中止须填写原因). */
export function operationBody(op: Operation, version: unknown, reason?: string): Record<string, unknown> {
  const v = versionOf(version, op);
  const r = reason?.trim();
  if ((op === 'cancel' || op === 'abandon') && !r) throw new InputError(`run ${op} 需要 --reason <原因>`);
  return r && op !== 'resume' && op !== 'pause' ? { version: v, reason: r } : { version: v };
}

/** The run's `version` as read by `GET /runs/{id}` (every operation sends it; 2723 on mismatch). */
export function versionOf(version: unknown, what: string): number {
  const v = Number(version);
  if (version === null || version === undefined || !Number.isInteger(v)) throw new Error(`运行详情缺少 version，无法执行 ${what}`);
  return v;
}

// ── errors (backend `AutomationErrorEnum`, design n3 §4 / §5) ──

const RUN_CODES: Record<number, string> = {
  1001: '参数不合法（如步骤不属于该任务、seq / 时间格式不对）',
  2703: 'AI 员工 Key 不能操作运行：暂停 / 中止 / 恢复 / 取消 / 重跑 / 改派只允许组织 owner / admin、自动化启用人或项目负责人（用人类账号的 Key）',
  2713: '该 AI 员工的岗位不含此节点要求的岗位，不能改派给它',
  2718: '步骤回报只接受 AI 员工 Key：当前是人类账号的 Key。请在 Runner 上用 AI 员工 Key（good7ob config set api-key <员工 Key>）',
  2719: '步骤已结束超过 10 分钟，不再接受回报（平台已按释放 / 超时处理该步骤）',
  2720: '该步骤不能重跑：只有运行 failed / paused 时其节点最近一次失败的步骤可以重跑',
  2721: '该节点已达重试上限，不能再重跑',
  2722: '该步骤日志已达 50 MB 上限，服务端已标记截断，不再接收；剩余日志只保留在本地',
  2723: '运行已被他人更新（version 冲突）：请重新执行命令（会重新读取 version），先用 good7ob run show 确认当前状态',
  2725: '只有已暂停的运行可以放弃',
  2727: '产物类型不在闭集内（PR / REVIEW_REPORT / TEST_RUN / EXTERNAL / …）',
};

/** 2000 is shared by several keys; the message prefix (`STEP_NOT_HELD: …`) tells them apart. */
const KEYED_2000: Record<string, string> = {
  STEP_NOT_HELD: '该步骤不是分配给本 AI 员工的（可能已被改派、租约已被收回或步骤已重跑为新尝试）。用 good7ob agent status 查看本地槽，必要时 good7ob agent reset',
  RUN_NOT_VISIBLE: '无权查看该运行（运行所属项目的成员与组织 owner / admin 可见；AI 员工只能读自己执行过的步骤）',
};

export function describeRunError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'number') return message;
  if (code === 999 || code === 401) return `未登录或凭证已失效，请先运行 good7ob config set api-key <key> [${code}]`;
  const key = /^([A-Z_]{4,}):/.exec(message)?.[1];
  const known = code === 2000 && key ? KEYED_2000[key] : RUN_CODES[code];
  if (!known) return `${message} (code=${code})`;
  return `${known} [${code}: ${message}]`;
}

/** Codes after which the local slot no longer holds the step (it is someone else's / over). */
export function stepLost(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code === 2719 || (code === 2000 && /^STEP_NOT_HELD/.test(message));
}

// ── log save ↔ run step (rp-auto-run-0037) ──

export interface RunLink {
  runId?: number;
  stepId?: number;
  nodeCode?: string;
  /** Set when the slot also supplied the task id (the backend requires step.task = record.task). */
  taskId?: number;
  fromSlot: boolean;
}

/**
 * `log save --run-id / --step-id / --node-code`. Without them, a busy slot holding a step supplies all three (and the
 * task id) unless `--no-run-link`, or the record is for another task (`--task-id` ≠ the slot's task: backend 1001).
 */
export function workRecordRunLink(
  o: { runId?: string; stepId?: string; nodeCode?: string; taskId?: string; runLink?: boolean },
  slot: AgentState | null
): RunLink {
  if (o.runId !== undefined || o.stepId !== undefined || o.nodeCode !== undefined) {
    const link: RunLink = { fromSlot: false };
    if (o.runId !== undefined) link.runId = parseId(o.runId, '--run-id');
    if (o.stepId !== undefined) link.stepId = parseId(o.stepId, '--step-id');
    if (o.nodeCode !== undefined && o.nodeCode.trim()) link.nodeCode = o.nodeCode.trim();
    return link;
  }
  if (o.runLink === false || !slot || slot.status === 'idle' || slot.stepId == null) return { fromSlot: false };
  if (o.taskId !== undefined && Number(o.taskId) !== slot.taskId) return { fromSlot: false };
  const link: RunLink = { stepId: slot.stepId, fromSlot: true };
  if (slot.runId != null) link.runId = slot.runId;
  if (slot.nodeCode) link.nodeCode = slot.nodeCode;
  if (o.taskId === undefined) link.taskId = slot.taskId;
  return link;
}
