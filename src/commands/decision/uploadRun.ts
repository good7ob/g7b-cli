import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import apiClient from '../../services/ApiClient';
import { InputError, describeError } from '../../utils/cliHelpers';
import { DECISION_ERROR_CODES } from './input';
import { Chunk, ChunkResult, Chunked, RowKind, chunkEntries, scanJsonl } from './upload';

/** decision upload 的执行：分块顺序发送、共用一个 batchId、汇总结果；某块失败即停（不重试，如实报告）。 */

const UPLOAD_TIMEOUT_MS = 120_000;

export interface ChunkReport { index: number; items: number; bytes: number; status: 'sent' | 'failed' | 'unsent' | 'planned'; error?: string }
export interface RejectedReport { line: number | null; sourceKey?: string; code?: number; field?: string; message?: string }
export interface KindCounts {
  structured: { valid: number; bad: number };
  implicit: { valid: number; bad: number };
  /** 不是 JSON / 不是对象 / source 无法识别的坏行 */
  unknown: { bad: number };
}
export interface UploadSummary {
  file: string;
  batchId: string;
  dryRun: boolean;
  validRows: number;
  byKind: KindCounts;
  badLines: { line: number; reason: string }[];
  oversized: { line: number; bytes: number }[];
  chunks: ChunkReport[];
  added: number;
  skipped: number;
  rejected: RejectedReport[];
  /** 第一个失败块的原始错误（用于退出码与提示）；dry-run 与全部成功时为 undefined */
  failure?: unknown;
}

export function readDecisionFile(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    throw new InputError(`无法读取 ${file}：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function sendChunk(batchId: string, chunk: Chunk): Promise<ChunkResult> {
  const data = await apiClient.post(
    '/api/v1/me/decisions/batch',
    { batchId, items: chunk.entries.map((e) => e.item) },
    { timeout: UPLOAD_TIMEOUT_MS }
  );
  return { added: data?.added ?? 0, skipped: data?.skipped ?? 0, rejected: Array.isArray(data?.rejected) ? data.rejected : [] };
}

const plan = (c: Chunked): ChunkReport[] =>
  c.chunks.map((ch, i) => ({ index: i + 1, items: ch.entries.length, bytes: ch.bytes, status: 'planned' as const }));

function countKinds(valid: RowKind[], bad: RowKind[]): KindCounts {
  const n = (list: RowKind[], k: RowKind) => list.filter((x) => x === k).length;
  return {
    structured: { valid: n(valid, 'structured'), bad: n(bad, 'structured') },
    implicit: { valid: n(valid, 'implicit'), bad: n(bad, 'implicit') },
    unknown: { bad: n(bad, 'unknown') },
  };
}

export async function runUpload(file: string, dryRun: boolean, limit?: number): Promise<UploadSummary> {
  const { entries, bad, badKinds } = scanJsonl(readDecisionFile(file));
  const batchId = randomUUID();
  const chunked = chunkEntries(entries, batchId, limit);
  const base: UploadSummary = {
    file, batchId, dryRun, validRows: entries.length, byKind: countKinds(entries.map((e) => e.item.sourceKind), badKinds), badLines: bad, oversized: chunked.oversized,
    chunks: plan(chunked), added: 0, skipped: 0, rejected: [],
  };
  if (dryRun) return base;
  if (chunked.chunks.length === 0) throw new InputError(`没有可上传的有效记录（坏行 ${bad.length}，超大 ${chunked.oversized.length}）`);
  return sendAll(base, chunked.chunks);
}

async function sendAll(base: UploadSummary, chunks: Chunk[]): Promise<UploadSummary> {
  let sum: UploadSummary = { ...base, chunks: base.chunks.map((c) => ({ ...c, status: 'unsent' as const })) };
  for (let i = 0; i < chunks.length; i++) {
    try {
      const r = await sendChunk(base.batchId, chunks[i]);
      const rejected = r.rejected.map((x) => ({ ...x, line: chunks[i].entries[x.index]?.line ?? null }));
      sum = {
        ...sum, added: sum.added + r.added, skipped: sum.skipped + r.skipped, rejected: [...sum.rejected, ...rejected],
        chunks: sum.chunks.map((c, j) => (j === i ? { ...c, status: 'sent' as const } : c)),
      };
    } catch (e) {
      const error = describeError(e, DECISION_ERROR_CODES);
      return { ...sum, failure: e, chunks: sum.chunks.map((c, j) => (j === i ? { ...c, status: 'failed' as const, error } : c)) };
    }
  }
  return sum;
}

const STATUS_TEXT = { sent: '已发送', failed: '失败', unsent: '未发送', planned: '将发送' } as const;

export function renderUploadSummary(s: UploadSummary): string {
  const lines = [
    `${s.dryRun ? '[dry-run，未发送任何请求] ' : ''}文件 ${s.file}`,
    `批次号 ${s.batchId}（之后撤销/清除整批用 --batch）`,
    `有效 ${s.validRows} 条，坏行 ${s.badLines.length}，本地拒绝（单条超大）${s.oversized.length}，分 ${s.chunks.length} 块`,
    `  点选：有效 ${s.byKind.structured.valid}，坏行 ${s.byKind.structured.bad}；隐式：有效 ${s.byKind.implicit.valid}，坏行 ${s.byKind.implicit.bad}；无法识别 ${s.byKind.unknown.bad}`,
    ...s.chunks.map((c) => `  块 ${c.index}：${c.items} 条 ${c.bytes} 字节 ${STATUS_TEXT[c.status]}${c.error ? `：${c.error}` : ''}`),
  ];
  if (!s.dryRun) lines.push(`结果：新增 ${s.added}，跳过 ${s.skipped}，服务端拒绝 ${s.rejected.length}`);
  if (s.badLines.length) lines.push('坏行：', ...s.badLines.map((b) => `  第 ${b.line} 行：${b.reason}`));
  if (s.oversized.length) lines.push('超大未发送：', ...s.oversized.map((o) => `  第 ${o.line} 行：${o.bytes} 字节`));
  if (s.rejected.length) {
    lines.push('服务端拒绝：', ...s.rejected.map((r) => `  第 ${r.line ?? '?'} 行 ${r.field ?? ''}：${r.message ?? ''}${r.code ? ` [${r.code}]` : ''}`));
  }
  return lines.join('\n');
}
