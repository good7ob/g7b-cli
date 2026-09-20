/**
 * Local guard for the attacker-controllable JSON that goes into a template version (`content`, `variables`,
 * `compatibility`). Mirrors the server's TemplateJsonGuard (api-0091 §1) so an oversize / too-deep document is
 * refused here with a clear message instead of being uploaded and answered with 1001.
 *
 * The scan is iterative and runs on the raw text BEFORE JSON.parse: JSON.parse itself recurses, so a
 * `[[[[…` bomb must never reach it.
 */

import * as fs from 'fs';
import { InputError } from '../../utils/cliHelpers';

export const MAX_DEPTH = 32;
export const MAX_NODES = 50_000;
export const MAX_CONTAINER_SIZE = 10_000;
export const MAX_CONTENT_BYTES = 1024 * 1024;
export const MAX_COMPATIBILITY_BYTES = 4096;
export const MAX_VARIABLES = 50;
/** Raw cap on what we are willing to read from disk (a pretty-printed 1 MB document is larger than 1 MB). */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

const WS = new Set([' ', '\t', '\n', '\r']);
const STOPS = new Set([',', ']', '}', '[', '{', ':', '"', ' ', '\t', '\n', '\r']);

/**
 * Throws InputError when `text` exceeds depth / node / per-container limits. Malformed JSON is left to JSON.parse.
 * `plainNumbers` additionally refuses exponent notation (1e5): used where a number becomes a template variable.
 */
export function scanJsonLimits(text: string, label: string, plainNumbers = false): void {
  const elements = new Int32Array(MAX_DEPTH + 2);
  let depth = 0;
  let nodes = 0;
  const value = () => {
    if (++nodes > MAX_NODES) throw new InputError(`${label}: 内容的值超过 ${MAX_NODES} 个`);
    if (depth > 0 && ++elements[depth] > MAX_CONTAINER_SIZE) {
      throw new InputError(`${label}: 数组或对象的元素超过 ${MAX_CONTAINER_SIZE} 个`);
    }
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (WS.has(c) || c === ',' || c === ':') {
      i++;
    } else if (c === '{' || c === '[') {
      value();
      if (++depth > MAX_DEPTH) throw new InputError(`${label}: 嵌套超过 ${MAX_DEPTH} 层`);
      elements[depth] = 0;
      i++;
    } else if (c === '}' || c === ']') {
      if (depth > 0) depth--;
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      let k = j + 1;
      while (k < text.length && WS.has(text[k])) k++;
      if (text[k] !== ':') value(); // a string followed by ':' is an object key, not a value
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !STOPS.has(text[j])) j++;
      const token = text.slice(i, j);
      // 1e999 parses to Infinity and would be serialised as null: refuse instead of silently changing the document
      if (/^-?[0-9]/.test(token) && !Number.isFinite(Number(token))) {
        throw new InputError(`${label}: 数字超出可表示范围: ${token.slice(0, 30)}`);
      }
      if (plainNumbers && /^-?[0-9]/.test(token) && /[eE]/.test(token)) {
        throw new InputError(`${label}: 数值请用普通小数写法，不支持指数: ${token.slice(0, 30)}`);
      }
      value();
      i = j;
    }
  }
}

/** Scan, then parse. Any failure is an InputError naming `label`. */
export function parseJsonText(text: string, label: string, plainNumbers = false): unknown {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  scanJsonLimits(clean, label, plainNumbers);
  try {
    return JSON.parse(clean);
  } catch (error) {
    throw new InputError(`${label}: 不是合法的 JSON（${(error as Error).message}）`);
  }
}

/**
 * Read a JSON file. Only a regular file is accepted (a FIFO / device / directory could hang or
 * exhaust memory); the check is made on the opened descriptor so the file cannot be swapped in between.
 */
export function readJsonFile(path: string, flag: string, maxBytes = MAX_FILE_BYTES): string {
  let fd: number | undefined;
  try {
    // O_NONBLOCK: opening a FIFO must not block waiting for a writer
    fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new InputError(`${flag} 必须指向普通文件: ${path}`);
    if (stat.size > maxBytes) {
      throw new InputError(`${flag} 文件过大（${stat.size} 字节，上限 ${maxBytes}）: ${path}`);
    }
    return fs.readFileSync(fd, 'utf-8');
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError(`${flag} 无法读取 ${path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export interface JsonSource {
  file?: string;
  inline?: string;
}

/** `--x-file` / `--x` (mutually exclusive) -> parsed JSON, or undefined when neither was given. */
export function loadJson(source: JsonSource, fileFlag: string, inlineFlag: string, label: string): unknown {
  if (source.file !== undefined && source.inline !== undefined) {
    throw new InputError(`${fileFlag} 与 ${inlineFlag} 不能同时使用`);
  }
  if (source.file !== undefined) return parseJsonText(readJsonFile(source.file, fileFlag), label);
  if (source.inline !== undefined) return parseJsonText(source.inline, label);
  return undefined;
}

const compactBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf-8');

/** `content` must be a JSON object and at most 1 MB once serialised compactly (as the server measures it). */
export function checkContent(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('content: 必须是 JSON 对象');
  }
  const bytes = compactBytes(value);
  if (bytes > MAX_CONTENT_BYTES) {
    throw new InputError(`content: 序列化后 ${bytes} 字节，超过上限 ${MAX_CONTENT_BYTES}（1 MB）`);
  }
  return value as Record<string, unknown>;
}

/** `variables` must be an array of at most 50 items (name/type rules are the server's: it answers 1001 with the JSON path). */
export function checkVariables(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new InputError('variables: 必须是 JSON 数组');
  if (value.length > MAX_VARIABLES) throw new InputError(`variables: 最多 ${MAX_VARIABLES} 个，当前 ${value.length} 个`);
  return value;
}

export function checkCompatibility(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('compatibility: 必须是 JSON 对象');
  }
  const bytes = compactBytes(value);
  if (bytes > MAX_COMPATIBILITY_BYTES) {
    throw new InputError(`compatibility: 序列化后 ${bytes} 字节，超过上限 ${MAX_COMPATIBILITY_BYTES}`);
  }
  return value as Record<string, unknown>;
}
