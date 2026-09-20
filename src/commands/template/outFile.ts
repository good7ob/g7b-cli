/**
 * `--out <file>` for rendered template output. The path is checked BEFORE any request (an instantiation must not
 * succeed only for the result to be unwritable), and the write itself re-checks atomically: no overwriting without
 * `--force`, regular files only (no symlink, directory, FIFO or device), nothing outside an existing directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { InputError, emit, fail } from '../../utils/cliHelpers';
import { outText } from './renderBody';

/** Flags that go with every `--out`. */
export interface OutFlags {
  out?: string;
  force?: boolean;
}

/** Absolute target path, or undefined when `--out` was not given. Throws InputError for an unusable path. */
export function checkOutTarget(o: OutFlags): string | undefined {
  if (o.force && o.out === undefined) throw new InputError('--force 只能与 --out 一起使用');
  if (o.out === undefined) return undefined;
  if (!o.out.trim()) throw new InputError('--out 不能为空');
  const file = path.resolve(o.out);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new InputError(`--out 的目录不存在: ${dir}`);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return file;
  if (stat.isSymbolicLink()) throw new InputError(`--out 不能是符号链接: ${file}`);
  if (!stat.isFile()) throw new InputError(`--out 必须是普通文件路径（不能是目录 / 设备 / 管道）: ${file}`);
  if (!o.force) throw new InputError(`--out 文件已存在，不会覆盖: ${file}（确认要覆盖请加 --force）`);
  return file;
}

/**
 * Write `text` (plus a final newline). Without `force` the file is created exclusively (O_EXCL), so a file that
 * appeared since the pre-check is never touched; with `force` a symlink is still refused (O_NOFOLLOW) and the opened
 * descriptor must be a regular file before it is truncated.
 */
export function writeOutFile(file: string, text: string, force?: boolean): void {
  const c = fs.constants;
  const flags = force
    ? c.O_WRONLY | c.O_CREAT | (c.O_NOFOLLOW ?? 0) | (c.O_NONBLOCK ?? 0)
    : c.O_WRONLY | c.O_CREAT | c.O_EXCL;
  const fd = fs.openSync(file, flags, 0o644);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('不是普通文件');
    if (force) fs.ftruncateSync(fd, 0);
    fs.writeFileSync(fd, text.endsWith('\n') ? text : `${text}\n`);
  } finally {
    fs.closeSync(fd);
  }
}

export interface OutTarget {
  file?: string;
  force?: boolean;
  /** the rendered content `--out` writes */
  content: unknown;
  /** shown when the write fails AFTER the server already did its work */
  failPrefix: string;
}

/**
 * Write `--out` (if any), print the result, and only then report a write failure: the objects were already created
 * (or the preview already rendered), so the user must still see what happened before the non-zero exit.
 */
export function emitWithOut(json: boolean | undefined, data: unknown, render: (writtenTo?: string) => string, target: OutTarget): void {
  let writtenTo: string | undefined;
  let failure: unknown;
  if (target.file) {
    try {
      writeOutFile(target.file, outText(target.content), target.force);
      writtenTo = target.file;
    } catch (error) {
      failure = error;
    }
  }
  emit(json, data, () => render(writtenTo));
  if (failure) fail(target.failPrefix, failure);
}
