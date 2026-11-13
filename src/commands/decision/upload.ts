import { redact } from './redact';

/**
 * decision upload 的纯逻辑（api-0189 §1）：抽取脚本 JSONL -> 请求 item、脱敏、按字节分块。
 * 不做任何 IO；project 字段含本机用户名路径，永不上传（prd-0127 rp-user-habit-0168）。
 */

export const CHUNK_MAX_BYTES = 4 * 1024 * 1024;
const RECOMMENDED = /（推荐）|\(recommended\)/i;

export interface DecisionOption { label: string; description: string | null; recommended: boolean }
export interface DecisionItem {
  sourceKind: 'structured';
  sourceKey: string;
  client: 'claude_code';
  sessionRef: string | null;
  occurredAt: number;
  question: string;
  situationUser: string | null;
  situationAssistant: string | null;
  options: DecisionOption[];
  choiceText: string;
  choiceType: 'option' | 'multi' | 'custom';
  isRecommendedChosen: boolean;
  rationale: string | null;
}
export interface Entry { line: number; item: DecisionItem }
export interface BadLine { line: number; reason: string }
export interface Parsed { entries: Entry[]; bad: BadLine[] }
export interface Chunk { entries: Entry[]; bytes: number }
export interface Chunked { chunks: Chunk[]; oversized: { line: number; bytes: number }[] }

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const optRedacted = (v: unknown): string | null => (typeof v === 'string' && v ? redact(v) : null);

/** 一行 -> item；缺必填字段抛 Error（调用方记为坏行）。 */
export function toItem(raw: unknown): DecisionItem {
  if (!isObj(raw)) throw new Error('不是 JSON 对象');
  const id = nonEmpty(raw.id);
  const question = nonEmpty(raw.question);
  const choice = nonEmpty(raw.choice);
  const missing = [!id && 'id', !question && 'question', !choice && 'choice'].filter(Boolean);
  if (missing.length) throw new Error(`缺少必填字段 ${missing.join('、')}`);
  const occurredAt = typeof raw.ts === 'string' ? Date.parse(raw.ts) : NaN;
  if (Number.isNaN(occurredAt)) throw new Error('ts 缺失或不是有效时间');
  if (!Array.isArray(raw.options) || raw.options.some((o) => !isObj(o) || !nonEmpty(o.label))) {
    throw new Error('options 必须是带 label 的数组');
  }
  const situation = isObj(raw.situation) ? raw.situation : {};
  const choiceType = raw.multi === true ? 'multi' : raw.custom === true ? 'custom' : 'option';
  const note = str(raw.note)?.trim();
  return {
    sourceKind: 'structured',
    sourceKey: `claude:${id}`,
    client: 'claude_code',
    sessionRef: str(raw.session) ?? null,
    occurredAt,
    question: redact(question as string),
    situationUser: optRedacted(situation.user_said),
    situationAssistant: optRedacted(situation.assistant_said),
    options: (raw.options as Raw[]).map((o) => ({
      label: redact(o.label as string),
      description: optRedacted(o.description),
      recommended: RECOMMENDED.test(o.label as string),
    })),
    choiceText: redact(choice as string),
    choiceType,
    // 服务端规定 custom 时必须为 false
    isRecommendedChosen: choiceType !== 'custom' && raw.chose_recommended === true,
    rationale: note ? redact(note) : null,
  };
}

/** 整个文件 -> 有效条目（带文件行号）+ 坏行；空行忽略。 */
export function parseJsonl(content: string): Parsed {
  const entries: Entry[] = [];
  const bad: BadLine[] = [];
  content.split(/\r?\n/).forEach((text, i) => {
    if (!text.trim()) return;
    const line = i + 1;
    try {
      entries.push({ line, item: toItem(JSON.parse(text)) });
    } catch (e) {
      const reason = e instanceof SyntaxError ? '不是合法 JSON' : (e as Error).message;
      bad.push({ line, reason });
    }
  });
  return { entries, bad };
}

const bytesOf = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');

/**
 * 按序列化后的请求体 UTF-8 字节数分块（每块 <= limit，含 {batchId, items} 外壳）。
 * 单条自己就超限的放进 oversized，不发送。
 */
export function chunkEntries(entries: Entry[], batchId: string, limit = CHUNK_MAX_BYTES): Chunked {
  const shell = bytesOf({ batchId, items: [] });
  const chunks: Chunk[] = [];
  const oversized: Chunked['oversized'] = [];
  let cur: { entries: Entry[]; bytes: number } | undefined;
  const flush = () => {
    if (cur) chunks.push(cur);
    cur = undefined;
  };
  for (const e of entries) {
    const size = bytesOf(e.item);
    if (shell + size > limit) {
      oversized.push({ line: e.line, bytes: shell + size });
      continue;
    }
    if (cur && cur.bytes + 1 + size > limit) flush(); // +1：非首条前面的逗号
    if (cur) {
      cur.entries.push(e);
      cur.bytes += 1 + size;
    } else {
      cur = { entries: [e], bytes: shell + size };
    }
  }
  flush();
  return { chunks, oversized };
}

export interface RejectedRow { index: number; sourceKey?: string; code?: number; field?: string; message?: string }
export interface ChunkResult { added: number; skipped: number; rejected: RejectedRow[] }

/** 服务端 rejected 的块内下标 -> 文件行号。 */
export const rejectedLine = (chunk: Chunk, index: number): number | undefined => chunk.entries[index]?.line;
