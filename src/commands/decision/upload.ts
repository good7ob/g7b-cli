import { redact } from './redact';

/**
 * decision upload 的纯逻辑（api-0189 §1）：抽取脚本 JSONL -> 请求 item、脱敏、按字节分块。
 * 不做任何 IO；project 字段含本机用户名路径，永不上传（prd-0127 rp-user-habit-0168）。
 */

export const CHUNK_MAX_BYTES = 4 * 1024 * 1024;
const RECOMMENDED = /（推荐）|\(recommended\)/i;

export interface DecisionOption { label: string; description: string | null; recommended: boolean }
export interface StructuredItem {
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
/** 隐式决策（api-0189 1.1.0，prd-0127 FP-20）：从自由文本抽取；options 可空，choiceType 可为 free_text。 */
export interface ImplicitItem extends Omit<StructuredItem, 'sourceKind' | 'choiceType' | 'isRecommendedChosen'> {
  sourceKind: 'implicit';
  choiceType: 'option' | 'multi' | 'custom' | 'free_text';
  isRecommendedChosen: false;
  domain: string | null;
  confidence: number;
}
export type DecisionItem = StructuredItem | ImplicitItem;
export type RowKind = 'structured' | 'implicit' | 'unknown';
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

/** 按 source 字段分类：缺省视为点选；除 structured / implicit 外的值无法识别。 */
export function kindOf(raw: unknown): RowKind {
  if (!isObj(raw) || (raw.source !== undefined && raw.source !== 'structured' && raw.source !== 'implicit')) return 'unknown';
  return raw.source === 'implicit' ? 'implicit' : 'structured';
}

/** 一行 -> item；缺必填字段抛 Error（调用方记为坏行）。 */
export function toItem(raw: unknown): DecisionItem {
  if (!isObj(raw)) throw new Error('不是 JSON 对象');
  const kind = kindOf(raw);
  if (kind === 'unknown') throw new Error('source 必须是 structured 或 implicit');
  return kind === 'implicit' ? toImplicitItem(raw) : toStructuredItem(raw);
}

const CHOICE_TYPES = ['option', 'multi', 'custom', 'free_text'] as const;

function toImplicitItem(raw: Raw): ImplicitItem {
  const sourceKey = nonEmpty(raw.source_key);
  const question = nonEmpty(raw.question);
  const choice = nonEmpty(raw.choice);
  const missing = [!sourceKey && 'source_key', !question && 'question', !choice && 'choice'].filter(Boolean);
  if (missing.length) throw new Error(`缺少必填字段 ${missing.join('、')}`);
  const occurredAt = typeof raw.ts === 'string' ? Date.parse(raw.ts) : NaN;
  if (Number.isNaN(occurredAt)) throw new Error('ts 缺失或不是有效时间');
  const choiceType = CHOICE_TYPES.find((t) => t === raw.choice_type);
  if (!choiceType) throw new Error('choice_type 缺失或不是 option / multi / custom / free_text');
  const confidence = raw.confidence;
  if (typeof confidence !== 'number' || !Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
    throw new Error('confidence 缺失或不是 0～100 的整数');
  }
  const options = raw.options === undefined ? [] : raw.options;
  if (!Array.isArray(options) || options.some((o) => !isObj(o) || !nonEmpty(o.label))) {
    throw new Error('options 必须是带 label 的数组（可为空）');
  }
  const note = str(raw.rationale)?.trim();
  return {
    sourceKind: 'implicit',
    sourceKey: sourceKey as string,
    client: 'claude_code',
    sessionRef: nonEmpty(raw.session) ? Array.from(raw.session as string).slice(0, 64).join('') : null,
    occurredAt,
    question: redact(question as string),
    situationUser: optRedacted(raw.reply), // 本人原回复
    situationAssistant: optRedacted(raw.situation_assistant),
    options: (options as Raw[]).map((o) => ({ label: redact(o.label as string), description: optRedacted(o.description), recommended: false })),
    choiceText: redact(choice as string),
    choiceType,
    isRecommendedChosen: false,
    domain: nonEmpty(raw.domain) ?? null,
    confidence,
    rationale: note ? redact(note) : null,
  };
}

function toStructuredItem(raw: Raw): StructuredItem {
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

/** parseJsonl + 每条坏行的类别（按 source 判定；不是 JSON 对象 / source 无法识别记为 unknown）。 */
export function scanJsonl(content: string): Parsed & { badKinds: RowKind[] } {
  const entries: Entry[] = [];
  const bad: BadLine[] = [];
  const badKinds: RowKind[] = [];
  content.split(/\r?\n/).forEach((text, i) => {
    if (!text.trim()) return;
    const line = i + 1;
    let kind: RowKind = 'unknown';
    try {
      const raw = JSON.parse(text);
      kind = kindOf(raw);
      entries.push({ line, item: toItem(raw) });
    } catch (e) {
      const reason = e instanceof SyntaxError ? '不是合法 JSON' : (e as Error).message;
      bad.push({ line, reason });
      badKinds.push(kind);
    }
  });
  return { entries, bad, badKinds };
}

/** 整个文件 -> 有效条目（带文件行号）+ 坏行；空行忽略。 */
export function parseJsonl(content: string): Parsed {
  const { entries, bad } = scanJsonl(content);
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
