import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InputError } from '../../../utils/cliHelpers';
import { buildListParams, checkUploadFiles, parseObjectType, resolveOutPath } from '../input';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-file-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('parseObjectType', () => {
  it('accepts the five object types in any case and rejects the rest', () => {
    for (const t of ['org', 'Product', 'PROJECT', 'task', 'prd-document']) expect(() => parseObjectType(t)).not.toThrow();
    expect(parseObjectType('Product')).toBe('product');
    expect(() => parseObjectType('bug')).toThrow(InputError);
  });
});

describe('buildListParams', () => {
  it('defaults to page 1 of 20 and passes only the filters that are set', () => {
    expect(buildListParams({})).toEqual({ page: 1, size: 20 });
    expect(buildListParams({ source: 'export', keyword: 'spec', children: true, page: '2', size: '50' })).toEqual({
      source: 'export', keyword: 'spec', includeChildren: true, page: 2, size: 50,
    });
  });

  it('rejects an unknown source and out-of-range paging', () => {
    expect(() => buildListParams({ source: 'mail' })).toThrow(InputError);
    expect(() => buildListParams({ size: '101' })).toThrow(InputError);
    expect(() => buildListParams({ page: '0' })).toThrow(InputError);
  });
});

describe('checkUploadFiles', () => {
  it('needs existing, non-empty regular files', () => {
    const ok = path.join(dir, 'a.txt');
    fs.writeFileSync(ok, 'x');
    const empty = path.join(dir, 'empty.txt');
    fs.writeFileSync(empty, '');
    expect(checkUploadFiles([ok])).toEqual([ok]);
    expect(() => checkUploadFiles([])).toThrow(InputError);
    expect(() => checkUploadFiles([path.join(dir, 'missing')])).toThrow(/不存在/);
    expect(() => checkUploadFiles([dir])).toThrow(/普通文件/);
    expect(() => checkUploadFiles([empty])).toThrow(/空/);
  });
});

describe('resolveOutPath', () => {
  it('writes into the current directory under the original name by default', () => {
    expect(resolveOutPath(undefined, 'spec.pdf', false, dir)).toBe(path.join(dir, 'spec.pdf'));
  });

  it('treats an existing directory or a trailing slash as a directory, anything else as the file path', () => {
    expect(resolveOutPath(dir, 'spec.pdf', false, '/')).toBe(path.join(dir, 'spec.pdf'));
    expect(resolveOutPath('out/', 'spec.pdf', false, dir)).toBe(path.join(dir, 'out', 'spec.pdf'));
    expect(resolveOutPath('renamed.pdf', 'spec.pdf', false, dir)).toBe(path.join(dir, 'renamed.pdf'));
  });

  it('keeps only the base name of what the server sent, so a hostile name cannot leave the directory', () => {
    expect(resolveOutPath(undefined, '../../etc/passwd', false, dir)).toBe(path.join(dir, 'passwd'));
    expect(resolveOutPath(undefined, '..\\..\\x.exe', false, dir)).toBe(path.join(dir, 'x.exe'));
  });

  it('refuses to overwrite unless forced', () => {
    fs.writeFileSync(path.join(dir, 'spec.pdf'), 'old');
    expect(() => resolveOutPath(undefined, 'spec.pdf', false, dir)).toThrow(/未覆盖/);
    expect(resolveOutPath(undefined, 'spec.pdf', true, dir)).toBe(path.join(dir, 'spec.pdf'));
  });
});
