/**
 * PlantUML source handling for `uc push` / `uc render`: the hash rule the server shares (api-0180 §13.1), reading a
 * source file, and the size check of the rendered PNG.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import { InputError } from '../../utils/cliHelpers';

/** Server limit on a source (PlantUmlSourceCheck.MAX_LENGTH, characters). Checked here so a render is not wasted. */
export const MAX_SOURCE_CHARS = 50_000;
/** FilePurpose.OBJECT_FILE: 100 MB per object file. */
export const MAX_PNG_BYTES = 100 * 1024 * 1024;
/** ObjectFileScanService.maxBytes default (clamd StreamMaxLength): with virus scanning on, larger files are refused. */
export const SCAN_PNG_BYTES = 25 * 1024 * 1024;

/** `\r\n` and a lone `\r` become `\n`; nothing else is touched (no trim, no BOM removal, no final newline). */
export function normalizeSource(source: string): string {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** UseCaseSourceHash.sha256: lower-case hex SHA-256 of the UTF-8 bytes of already normalized text. */
export function sha256Normalized(normalized: string): string {
  return createHash('sha256').update(Buffer.from(normalized, 'utf8')).digest('hex');
}

/** UseCaseSourceHash.of: normalize, then hash. */
export function sourceHash(source: string): string {
  return sha256Normalized(normalizeSource(source));
}

/** Reads a .puml file as the exact text that is rendered, hashed and submitted (normalized line ends). */
export function readSourceFile(file: string): string {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new InputError(`找不到源码文件: ${file}`);
  }
  if (!stat.isFile()) throw new InputError(`不是文件: ${file}`);
  if (stat.size > MAX_SOURCE_CHARS * 4) throw new InputError(`源码文件过大（服务端限制 ${MAX_SOURCE_CHARS} 字符）: ${file}`);
  const text = normalizeSource(fs.readFileSync(file, 'utf8'));
  if (!text.trim()) throw new InputError(`源码文件是空的: ${file}`);
  if (text.charCodeAt(0) === 0xfeff) throw new InputError('源码文件带 BOM（UTF-8 签名），服务端会拒绝；请改存为无 BOM 的 UTF-8');
  if (Array.from(text).length > MAX_SOURCE_CHARS) throw new InputError(`源码超过 ${MAX_SOURCE_CHARS} 字符（服务端限制）`);
  return text;
}

export interface PngSizeVerdict { error?: string; warning?: string }

/** rp-ucase-0068: the PNG becomes an object file, so the object-file limits apply before anything is uploaded. */
export function checkPngSize(bytes: number): PngSizeVerdict {
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  if (bytes > MAX_PNG_BYTES) {
    return { error: `渲染图 ${mb(bytes)} MB，超过对象文件单文件上限 ${mb(MAX_PNG_BYTES)} MB，不会上传；请拆小图` };
  }
  if (bytes > SCAN_PNG_BYTES) {
    return { warning: `渲染图 ${mb(bytes)} MB，超过 ${mb(SCAN_PNG_BYTES)} MB；服务端开启病毒扫描时会拒绝，建议拆小图` };
  }
  return {};
}
