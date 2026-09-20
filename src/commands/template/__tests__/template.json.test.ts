import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { InputError } from '../../../utils/cliHelpers';
import {
  MAX_FILE_BYTES, checkCompatibility, checkContent, checkVariables, loadJson, parseJsonText, readJsonFile, scanJsonLimits,
} from '../jsonInput';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-json-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (name: string, text: string) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
};
const nested = (levels: number) => `{"a":${'['.repeat(levels - 1)}${']'.repeat(levels - 1)}}`; // object + (levels-1) arrays

describe('scanJsonLimits (mirrors the server TemplateJsonGuard)', () => {
  it('accepts depth 32 and rejects depth 33', () => {
    expect(() => scanJsonLimits(nested(32), 'content')).not.toThrow();
    expect(() => scanJsonLimits(nested(33), 'content')).toThrow(/content: 嵌套超过 32 层/);
  });

  it('a 200,000-level bomb is rejected by the iterative scan without ever reaching JSON.parse', () => {
    const bomb = '['.repeat(200_000) + ']'.repeat(200_000);
    expect(() => parseJsonText(bomb, 'content')).toThrow(InputError);
    expect(() => parseJsonText(bomb, 'content')).toThrow(/嵌套超过 32 层/);
  });

  it('counts values (scalars + containers), not object keys: 50,000 ok, 50,001 rejected', () => {
    // root array + 5 inner arrays = 6 containers, plus the zeros
    const chunk = (n: number) => `[${new Array(n).fill(0).join(',')}]`;
    const over = `[${[chunk(9999), chunk(9999), chunk(9999), chunk(9999), chunk(9999)].join(',')}]`; // 6 + 49,995 = 50,001
    expect(() => scanJsonLimits(over, 'content')).toThrow(/值超过 50000 个/);
    const ok = `[${[chunk(9999), chunk(9999), chunk(9999), chunk(9999), chunk(9998)].join(',')}]`; // 6 + 49,994 = 50,000
    expect(() => scanJsonLimits(ok, 'content')).not.toThrow();
  });

  it('rejects a container with more than 10,000 elements', () => {
    expect(() => scanJsonLimits(`[${new Array(10_001).fill(1).join(',')}]`, 'variables')).toThrow(/元素超过 10000 个/);
    expect(() => scanJsonLimits(`[${new Array(10_000).fill(1).join(',')}]`, 'variables')).not.toThrow();
  });

  it('does not count object keys, and ignores brackets inside strings (escaped quotes included)', () => {
    expect(() => scanJsonLimits('{"[[[[":"]]]]","q\\"[":["\\\\"]}', 'content')).not.toThrow();
    const keysOnly = `{${new Array(5000).fill(0).map((_, i) => `"k${i}":1`).join(',')}}`;
    expect(() => scanJsonLimits(keysOnly, 'content')).not.toThrow();
  });

  it('refuses a number that JSON.parse would turn into Infinity (it would be sent as null)', () => {
    expect(() => scanJsonLimits('{"n":1e999}', 'content')).toThrow(/数字超出可表示范围/);
    expect(() => scanJsonLimits('{"n":1e30,"m":-2.5e-3,"t":true,"z":null}', 'content')).not.toThrow();
  });
});

describe('parseJsonText', () => {
  it('parses valid JSON, strips a BOM, and names the label on malformed input', () => {
    expect(parseJsonText('﻿{"a":1}', 'content')).toEqual({ a: 1 });
    expect(() => parseJsonText('{"a":', 'content')).toThrow(/content: 不是合法的 JSON/);
    expect(() => parseJsonText('', 'variables')).toThrow(/variables: 不是合法的 JSON/);
  });
});

describe('readJsonFile / loadJson', () => {
  it('reads a regular file (also through a symlink)', () => {
    const file = write('ok.json', '{"a":1}');
    const link = path.join(dir, 'link.json');
    fs.symlinkSync(file, link);
    expect(readJsonFile(file, '--content-file')).toBe('{"a":1}');
    expect(readJsonFile(link, '--content-file')).toBe('{"a":1}');
  });

  it('rejects a missing file, a directory and a device', () => {
    expect(() => readJsonFile(path.join(dir, 'nope.json'), '--content-file')).toThrow(/无法读取.*ENOENT/);
    expect(() => readJsonFile(dir, '--content-file')).toThrow(/必须指向普通文件/);
    expect(() => readJsonFile('/dev/null', '--content-file')).toThrow(/必须指向普通文件/);
  });

  it('rejects a file over the raw size cap before reading it', () => {
    const file = path.join(dir, 'huge.json');
    fs.closeSync(fs.openSync(file, 'w'));
    fs.truncateSync(file, MAX_FILE_BYTES + 1); // sparse: no real 8 MB written
    expect(() => readJsonFile(file, '--content-file')).toThrow(/文件过大/);
  });

  it('--x-file and --x are mutually exclusive; neither -> undefined', () => {
    expect(() => loadJson({ file: 'a', inline: '{}' }, '--content-file', '--content', 'content')).toThrow(/不能同时使用/);
    expect(loadJson({}, '--content-file', '--content', 'content')).toBeUndefined();
    expect(loadJson({ inline: '{"x":[1]}' }, '--content-file', '--content', 'content')).toEqual({ x: [1] });
  });
});

describe('size / shape checks', () => {
  it('content must be an object of at most 1 MB serialised compactly', () => {
    expect(checkContent({ markdown: 'x' })).toEqual({ markdown: 'x' });
    expect(() => checkContent([1])).toThrow(/content: 必须是 JSON 对象/);
    expect(() => checkContent(null)).toThrow(/必须是 JSON 对象/);
    expect(() => checkContent({ markdown: 'x'.repeat(1024 * 1024) })).toThrow(/超过上限 1048576/);
    expect(() => checkContent({ markdown: 'x'.repeat(1024 * 1024 - 15) })).not.toThrow();
  });

  it('measures bytes, not characters (CJK is 3 bytes)', () => {
    expect(() => checkContent({ body: '模'.repeat(400_000) })).toThrow(/超过上限/);
  });

  it('variables: an array of at most 50', () => {
    expect(checkVariables(new Array(50).fill({}))).toHaveLength(50);
    expect(() => checkVariables(new Array(51).fill({}))).toThrow(/最多 50 个，当前 51 个/);
    expect(() => checkVariables({})).toThrow(/必须是 JSON 数组/);
  });

  it('compatibility: an object of at most 4 KB', () => {
    expect(checkCompatibility({ vue: '3' })).toEqual({ vue: '3' });
    expect(() => checkCompatibility({ a: 'x'.repeat(4096) })).toThrow(/超过上限 4096/);
    expect(() => checkCompatibility([])).toThrow(/必须是 JSON 对象/);
  });
});
