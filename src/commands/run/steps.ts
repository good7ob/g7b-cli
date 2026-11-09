/**
 * Runner-side reports of `good7ob run` that touch the API and the local slot (prd-0137 FP-3 / FP-4, backend #992):
 * org resolution, the log seq counter kept in the slot, chunked log upload, done / fail with slot release.
 * `agent done` reuses {@link finishStep} for a slot that carries a step.
 */

import { execFileSync } from 'child_process';
import configService from '../../services/ConfigService';
import { InputError, parseId } from '../../utils/cliHelpers';
import { extractRecords } from '../../utils/extractRecords';
import { resolveOrgId } from '../../utils/resolveOrgId';
import { AgentStateStore, IDLE } from '../agent/state';
import { FileItem, STEP_LOG_CAP, StepTarget, chunkLog, diffSummary, logChunkBody, maskSecrets, stepBase } from './input';

export interface Api {
  get(url: string, params?: Record<string, any>): Promise<any>;
  post(url: string, data?: any): Promise<any>;
}

/**
 * --org-id, then the org of the slot's step, GOOD7OB_ORG_ID / `config set org-id`, then the org the slot recorded for
 * another step of this machine (an AI employee key belongs to one org), then the key's only organisation.
 */
export async function resolveOrg(api: Api, option: string | undefined, slotOrg?: number, machineOrg?: number | null): Promise<number> {
  if (option !== undefined) return parseId(option, '--org-id');
  if (slotOrg != null) return slotOrg;
  const configured = configService.get('orgId');
  if (process.env.GOOD7OB_ORG_ID !== undefined || configured !== undefined) return resolveOrgId(undefined, configured);
  if (machineOrg != null) return machineOrg;
  const orgs = extractRecords<{ id: number; name?: string }>(await api.get('/api/v1/orgs', { page: 1, pageSize: 20 }));
  if (orgs.length === 1) return orgs[0].id;
  throw new InputError(
    orgs.length
      ? `你属于 ${orgs.length} 个组织，请用 --org-id 指定：${orgs.map((g) => `#${g.id} ${g.name ?? ''}`.trim()).join('、')}`
      : '缺少组织：请使用 --org-id <id>、环境变量 GOOD7OB_ORG_ID，或 `good7ob config set org-id <id>`'
  );
}

// ── logs ──

/** Highest stored seq of the step (`GET …/logs?limit=1` without cursor answers the newest segment; `next` = its seq). */
export async function remoteLastSeq(api: Api, orgId: number, t: StepTarget): Promise<number> {
  try {
    const r = await api.get(`${stepBase(orgId, t)}/logs`, { limit: 1 });
    const n = Number(r?.next);
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Reserves `count` seqs. `--seq` wins; for the slot's step the slot counter continues (first use per slot starts
 * after the server's last segment, so a re-claimed step never re-sends seq 1 into an existing segment); any other
 * step starts after the server's last segment. The slot counter is advanced before sending: a failed upload is
 * retried idempotently with `--seq <first>` (segments already stored come back as duplicates).
 */
export async function reserveSeqs(api: Api, store: AgentStateStore, orgId: number, t: StepTarget, count: number, explicit?: number): Promise<number> {
  if (!t.fromSlot) return explicit ?? (await remoteLastSeq(api, orgId, t)) + 1;
  const known = store.read();
  const needRemote = explicit === undefined && known.status !== 'idle' && known.stepId === t.stepId && known.logSeq === undefined;
  const remote = needRemote ? await remoteLastSeq(api, orgId, t) : 0;
  return store.withLock(async () => {
    const cur = store.read();
    if (cur.status === 'idle' || cur.stepId !== t.stepId) return explicit ?? remote + 1;
    const last = cur.logSeq ?? remote;
    const first = explicit ?? last + 1;
    store.write({ ...cur, logSeq: Math.max(last, first + count - 1) });
    return first;
  });
}

export interface AppendResult {
  first: number;
  last: number;
  segments: number;
  bytes: number;
  duplicates: number[];
  totalBytes: number | null;
  truncated: boolean;
}

export class LogUploadError extends Error {
  constructor(public readonly cause: unknown, public readonly firstSeq: number, public readonly failedSeq: number, public readonly sent: number) {
    super(cause instanceof Error ? cause.message : String(cause));
    const code = (cause as { code?: unknown } | null)?.code;
    if (code !== undefined) (this as unknown as { code: unknown }).code = code;
  }
}

/** Masks, chunks (≤ 1 MB) and posts the text as consecutive segments. */
export async function appendLog(
  api: Api,
  store: AgentStateStore,
  orgId: number,
  t: StepTarget,
  text: string,
  explicitSeq?: number,
  warn: (m: string) => void = () => undefined
): Promise<AppendResult> {
  const chunks = chunkLog(maskSecrets(text));
  if (!chunks.length) throw new InputError('日志内容为空，未上传');
  const bytes = chunks.reduce((n, c) => n + Buffer.byteLength(c, 'utf-8'), 0);
  if (bytes > STEP_LOG_CAP) warn(`! 日志共 ${bytes} 字节，超过单步 50 MB 上限：服务端会在到达上限时拒收（2722）`);
  const first = await reserveSeqs(api, store, orgId, t, chunks.length, explicitSeq);
  const url = `${stepBase(orgId, t)}/logs`;
  const out: AppendResult = { first, last: first + chunks.length - 1, segments: chunks.length, bytes, duplicates: [], totalBytes: null, truncated: false };
  for (let i = 0; i < chunks.length; i++) {
    const seq = first + i;
    let r: any;
    try {
      r = await api.post(url, logChunkBody(seq, chunks[i]));
    } catch (e) {
      throw new LogUploadError(e, first, seq, i);
    }
    if (r?.duplicate) out.duplicates.push(seq);
    if (r?.totalBytes != null) out.totalBytes = Number(r.totalBytes);
    if (r?.truncated) out.truncated = true;
  }
  return out;
}

// ── done / fail ──

/** Frees the local slot when it still holds this step (the step is over for this runner either way). */
export async function releaseSlotStep(store: AgentStateStore, stepId: number): Promise<boolean> {
  return store.withLock(async () => {
    const cur = store.read();
    if (cur.status === 'idle' || cur.stepId !== stepId) return false;
    store.write(IDLE);
    return true;
  });
}

export interface FinishResult {
  data: any;
  slotFreed: boolean;
}

/** `POST …/done` or `…/fail`; the slot is freed when it held this step. */
export async function finishStep(api: Api, store: AgentStateStore, orgId: number, t: StepTarget, kind: 'done' | 'fail', body: Record<string, unknown>): Promise<FinishResult> {
  const data = await api.post(`${stepBase(orgId, t)}/${kind}`, body);
  const slotFreed = t.fromSlot ? await releaseSlotStep(store, t.stepId) : false;
  return { data, slotFreed };
}

export function describeFinish(kind: 'done' | 'fail', t: StepTarget, r: FinishResult): string {
  const d = r.data ?? {};
  const parts = [`✓ 运行 #${t.runId} 步骤 #${t.stepId} 已回报${kind === 'done' ? '完成' : '失败'}（${d.status ?? '-'}）`];
  if (d.nextStep) parts.push(`下一步: ${d.nextStep.nodeCode ?? ''} #${d.nextStep.stepId}`);
  if (d.retry) parts.push(`返工: ${d.retry.nodeCode ?? ''} #${d.retry.stepId}（第 ${d.retry.attempt ?? '?'} 次尝试）`);
  if (d.taskStatus) parts.push(`任务状态: ${d.taskStatus}`);
  if (d.runStatus) parts.push(`运行状态: ${d.runStatus}`);
  if (r.slotFreed) parts.push('本地工作槽已空闲');
  return parts.join('，');
}

// ── git ──

export type Git = (args: string[]) => string;

export const realGit: Git = (args) => execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** `git diff --numstat <base>...HEAD` (+ `--name-status` for A / D / R): paths and counts only. */
export function gitDiffSummary(git: Git, base: string, prUrl?: string): { files: FileItem[]; branch?: string; commitRange: string } {
  if (!base.trim() || base.startsWith('-')) throw new InputError(`--from-git 需要一个 git 基线（分支 / tag / commit），收到: ${base}`);
  let files: FileItem[];
  let commitRange: string;
  try {
    const range = `${base}...HEAD`;
    files = diffSummary(git(['diff', '--numstat', '-z', '-M', range]), git(['diff', '--name-status', '-z', '-M', range]), prUrl);
    const mergeBase = git(['merge-base', base, 'HEAD']).trim().slice(0, 12);
    const head = git(['rev-parse', '--short=12', 'HEAD']).trim();
    commitRange = `${mergeBase}..${head}`;
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const detail = (err.stderr ? String(err.stderr) : err.message ?? String(e)).trim().split('\n')[0];
    throw new InputError(`git diff ${base}...HEAD 失败（需在 git 仓库内，基线需存在）: ${detail}`);
  }
  let branch: string | undefined;
  try {
    const b = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (b && b !== 'HEAD') branch = b;
  } catch {
    /* detached / not important */
  }
  return { files, branch, commitRange };
}
