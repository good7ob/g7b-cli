/**
 * CLI-boundary validation for `file` commands (prd-0132, api-0130). The backend validates again and decides who may
 * see or change what; this only rejects obvious mistakes before a request.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ErrorCodeMap, InputError, parseIntInRange, requireOneOf } from '../../utils/cliHelpers';

export const OBJECT_TYPES = ['org', 'product', 'project', 'task', 'prd-document'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];
export const SOURCES = ['upload', 'export', 'deliverable', 'knowledge_base'] as const;

/** Largest object file the platform takes (FilePurpose.OBJECT_FILE); checked here so a big file fails before upload. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const FILE_ERROR_CODES: ErrorCodeMap = {
  999: '未登录',
  1000: '缺少必填参数',
  1001: '参数不合法，或存储空间不足（看提示里的已用 / 上限）',
  1002: '对象或文件不存在，或你看不到它',
  1007: '当前状态不支持该操作（文件扫描中、已隔离、机密、类型不受支持等）',
  2000: '无权操作',
};

export function parseObjectType(raw: string): ObjectType {
  return requireOneOf(raw.trim().toLowerCase(), OBJECT_TYPES, '<objectType>');
}

export interface ListOptions {
  source?: string;
  keyword?: string;
  children?: boolean;
  page?: string;
  size?: string;
}

export function buildListParams(o: ListOptions): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (o.source !== undefined) params.source = requireOneOf(o.source, SOURCES, '--source');
  if (o.keyword) params.keyword = o.keyword;
  if (o.children) params.includeChildren = true;
  params.page = o.page === undefined ? 1 : parseIntInRange(o.page, '--page', 1, 100000);
  params.size = o.size === undefined ? 20 : parseIntInRange(o.size, '--size', 1, 100);
  return params;
}

/** Local files to upload: each must exist, be a regular file, non-empty and within the platform limit. */
export function checkUploadFiles(paths: string[]): string[] {
  if (paths.length === 0) throw new InputError('至少指定一个要上传的文件');
  for (const p of paths) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(p);
    } catch {
      throw new InputError(`文件不存在: ${p}`);
    }
    if (!stat.isFile()) throw new InputError(`不是普通文件: ${p}`);
    if (stat.size === 0) throw new InputError(`文件是空的: ${p}`);
    if (stat.size > MAX_UPLOAD_BYTES) throw new InputError(`文件超过 100 MB 上限: ${p}`);
  }
  return paths;
}

/**
 * Where a download is written: `--out` as a directory (existing, or ending in a separator) gets the file's own name,
 * otherwise it is the file path; without `--out` the current directory. The name from the server is reduced to its base
 * name so a hostile name cannot escape the directory. An existing file is kept unless `--force` (prd-0020 rp-0068).
 */
export function resolveOutPath(out: string | undefined, fileName: string, force: boolean, cwd = process.cwd()): string {
  const safeName = path.basename(fileName.replace(/\\/g, '/')) || 'download';
  let target: string;
  if (out === undefined) {
    target = path.join(cwd, safeName);
  } else {
    const resolved = path.resolve(cwd, out);
    const isDir = /[\\/]$/.test(out) || (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory());
    target = isDir ? path.join(resolved, safeName) : resolved;
  }
  if (!force && fs.existsSync(target)) {
    throw new InputError(`文件已存在，未覆盖: ${target}（加 --force 覆盖）`);
  }
  return target;
}
