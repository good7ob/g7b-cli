import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { InputError } from '../../../utils/cliHelpers';
import { registerTemplateCommands } from '../index';
import { renderLocally, resolveAgainstDefs } from '../localRender';
import { loadVarsFile, parseItemOverrides, parseVarFlags } from '../varsInput';
import { noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-vars-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());
const write = (name: string, text: string) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
};
const NUL = String.fromCharCode(0);

describe('--var / --item parsing', () => {
  it('splits at the first "=", trims the name, keeps the value verbatim', () => {
    expect(parseVarFlags([' a = b', 'url=http://x?y=1', 'empty='])).toEqual({ a: ' b', url: 'http://x?y=1', empty: '' });
  });

  it('rejects malformed pairs, bad names, duplicates, NUL and long values', () => {
    expect(() => parseVarFlags(['novalue'])).toThrow(/name=value/);
    expect(() => parseVarFlags(['9a=1'])).toThrow(/不是合法的变量名/);
    expect(() => parseVarFlags(['__proto__=1'])).toThrow(/不是合法的变量名/);
    expect(() => parseVarFlags([`${'a'.repeat(51)}=1`])).toThrow(/不是合法的变量名/);
    expect(() => parseVarFlags(['a=1', 'a=2'])).toThrow(/变量 a 重复/);
    expect(() => parseVarFlags([`a=${NUL}`])).toThrow(/NUL/);
    expect(() => parseVarFlags([`a=${'x'.repeat(5001)}`])).toThrow(/最多 5000/);
    expect(parseVarFlags([`a=${'x'.repeat(5000)}`]).a).toHaveLength(5000);
  });

  it('--item groups overrides per template in first-seen order', () => {
    expect(parseItemOverrides(['4:a=1', '9:b=2', '4:c=3'])).toEqual([
      { templateId: 4, variables: { a: '1', c: '3' } },
      { templateId: 9, variables: { b: '2' } },
    ]);
    expect(() => parseItemOverrides(['a=1'])).toThrow(/<templateId>:<name>=<value>/);
    expect(() => parseItemOverrides(['x:a=1'])).toThrow(/templateId 必须是正整数/);
    expect(() => parseItemOverrides(['4:a'])).toThrow(/name=value/);
    expect(() => parseItemOverrides(['4:a=1', '4:a=2'])).toThrow(/变量 a 重复/);
    expect(() => parseItemOverrides(Array.from({ length: 21 }, (_, i) => `${i + 1}:a=1`))).toThrow(/最多覆盖 20 个模板/);
  });
});

describe('--vars-file', () => {
  it('accepts a flat object of scalars', () => {
    expect(loadVarsFile(write('ok.json', '{"a":"x","n":1.5,"b":false,"z":null}'))).toEqual({ a: 'x', n: 1.5, b: false, z: null });
  });

  it('refuses a depth bomb (200,000 levels) without recursing, and depth 33 inside a value', () => {
    const bomb = write('bomb.json', `{"a":${'['.repeat(200_000)}${']'.repeat(200_000)}}`);
    expect(() => loadVarsFile(bomb)).toThrow(/嵌套超过 32 层/);
    const deep = write('deep.json', `{"a":${'['.repeat(33)}${']'.repeat(33)}}`);
    expect(() => loadVarsFile(deep)).toThrow(/嵌套超过 32 层/);
  });

  it('refuses exponent numbers: 1e100000 (Infinity), 1e5 and 1E-3', () => {
    expect(() => loadVarsFile(write('e1.json', '{"n":1e100000}'))).toThrow(/数字超出可表示范围|指数/);
    expect(() => loadVarsFile(write('e2.json', '{"n":1e5}'))).toThrow(/不支持指数/);
    expect(() => loadVarsFile(write('e3.json', '{"n":1E-3}'))).toThrow(/不支持指数/);
    expect(loadVarsFile(write('e4.json', '{"n":"1e5"}'))).toEqual({ n: '1e5' }); // a string is just a string
  });

  it('refuses numbers a JS double cannot hold exactly: pass them as strings', () => {
    expect(() => loadVarsFile(write('big.json', '{"n":12345678901234567890}'))).toThrow(/请改写成字符串/);
    expect(() => loadVarsFile(write('tiny.json', '{"n":0.0000001}'))).toThrow(/请改写成字符串/);
  });

  it('refuses non-objects, container values, bad keys, NUL, >50 keys and files over 1 MB', () => {
    expect(() => loadVarsFile(write('arr.json', '[1]'))).toThrow(/必须是 JSON 对象/);
    expect(() => loadVarsFile(write('str.json', '"x"'))).toThrow(/必须是 JSON 对象/);
    expect(() => loadVarsFile(write('nested.json', '{"a":{"b":1}}'))).toThrow(/值必须是字符串、数字或布尔值/);
    expect(() => loadVarsFile(write('list.json', '{"a":[1]}'))).toThrow(/值必须是字符串、数字或布尔值/);
    expect(() => loadVarsFile(write('key.json', '{"1a":"x"}'))).toThrow(/不是合法的变量名/);
    expect(() => loadVarsFile(write('proto.json', '{"__proto__":"x"}'))).toThrow(/不是合法的变量名/);
    expect(() => loadVarsFile(write('nul.json', '{"a":"\\u0000"}'))).toThrow(/NUL/);
    expect(() => loadVarsFile(write('many.json', JSON.stringify(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`v${i}`, 1])))))).toThrow(/最多 50 个变量/);
    expect(() => loadVarsFile(write('huge.json', `{"a":"${'x'.repeat(1024 * 1024)}"}`))).toThrow(/文件过大/);
    expect(() => loadVarsFile(write('bad.json', '{"a":'))).toThrow(/不是合法的 JSON/);
    expect(() => loadVarsFile(path.join(dir, 'missing.json'))).toThrow(/无法读取/);
  });

  it('refuses a directory and a FIFO (must be a regular file)', () => {
    expect(() => loadVarsFile(dir)).toThrow(InputError);
    const fifo = path.join(dir, 'pipe');
    try {
      execFileSync('mkfifo', [fifo]);
    } catch {
      return; // platform without mkfifo
    }
    expect(() => loadVarsFile(fifo)).toThrow(/必须指向普通文件/);
  });

  it('through the CLI a bad file stops the command before any request', async () => {
    const file = write('cli-bomb.json', `{"a":${'['.repeat(100_000)}${']'.repeat(100_000)}}`);
    for (const args of [
      ['template', 'use', '4', '--org', '3', '--product', '9', '--vars-file', file],
      ['template', 'package', 'use', '5', '--org', '3', '--product', '9', '--vars-file', file],
      ['template', 'upgrade', '31', '--preview', '--vars-file', file],
    ]) {
      const r = await runCli(registerTemplateCommands, args, ok(null));
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('嵌套超过 32 层');
      expect(noHttpCalls(r)).toBe(true);
    }
  });
});

describe('local variable resolution (mirrors TemplateVariableResolver)', () => {
  const defs = [
    { name: 'title', type: 'string', required: true },
    { name: 'hours', type: 'number', required: false, default: '8' },
    { name: 'level', type: 'enum', options: ['low', 'high'], required: false, default: 'low' },
    { name: 'due', type: 'date', required: false },
    { name: 'urgent', type: 'boolean', required: false },
    { name: 'note', type: 'string', required: false },
  ];

  it('fills defaults, types values, and uses "" for an optional variable with no value', () => {
    const r = resolveAgainstDefs(defs, { title: 'T', urgent: 'TRUE', due: '2026-10-01' });
    expect(r.text).toEqual({ title: 'T', hours: '8', level: 'low', due: '2026-10-01', urgent: 'true', note: '' });
    expect(r.typed).toEqual({ title: 'T', hours: 8, level: 'low', due: '2026-10-01', urgent: true });
  });

  it('normalises plain decimals like BigDecimal.toPlainString', () => {
    const num = (v: string) => resolveAgainstDefs(defs, { title: 'T', hours: v }).text.hours;
    expect(num('007')).toBe('7');
    expect(num('-0.0')).toBe('0.0');
    expect(num(' 12.50 ')).toBe('12.50');
    expect(num('-3.5')).toBe('-3.5');
    expect(resolveAgainstDefs(defs, { title: 'T', hours: 2.5 as never }).typed.hours).toBe(2.5);
  });

  it('rejects exponent numbers, signs, separators, and out-of-range digits', () => {
    for (const bad of ['1e100000', '1e5', '1E-3', '+5', '1,000', '.5', '5.', '0x10', 'NaN', 'Infinity', '', ' ', `${'9'.repeat(31)}`, `0.${'1'.repeat(31)}`, '9'.repeat(65)]) {
      expect(() => resolveAgainstDefs(defs, { title: 'T', hours: bad }), bad).toThrow(/变量 hours/);
    }
    expect(() => resolveAgainstDefs(defs, { title: 'T', hours: true as never })).toThrow(/必须是普通小数/);
    expect(resolveAgainstDefs(defs, { title: 'T', hours: '9'.repeat(30) }).text.hours).toBe('9'.repeat(30));
  });

  it('checks enum options, dates, booleans, string type, unknown names and required', () => {
    expect(() => resolveAgainstDefs(defs, { title: 'T', level: 'mid' })).toThrow(/变量 level: 必须是 \["low","high"\] 之一/);
    expect(() => resolveAgainstDefs(defs, { title: 'T', due: '2026-02-30' })).toThrow(/变量 due/);
    expect(() => resolveAgainstDefs(defs, { title: 'T', due: '2026/02/01' })).toThrow(/变量 due/);
    expect(() => resolveAgainstDefs(defs, { title: 'T', urgent: 'yes' })).toThrow(/必须是 true 或 false/);
    expect(() => resolveAgainstDefs(defs, { title: 5 as never })).toThrow(/变量 title: 必须是字符串/);
    expect(() => resolveAgainstDefs(defs, { title: 'T', nope: '1' })).toThrow(/变量 nope 未在该模板版本中定义（已定义: title, hours/);
    expect(() => resolveAgainstDefs(defs, {})).toThrow(/缺少必填变量: title/);
    expect(() => resolveAgainstDefs(defs, { title: '   ' })).toThrow(/缺少必填变量: title/);
    expect(() => resolveAgainstDefs(defs, { title: 'x'.repeat(5001) })).toThrow(/长度不能超过 5000/);
  });
});

describe('local rendering (mirrors TemplateRenderer)', () => {
  const values = { a: 'X', b: '{{a}}', long: 'y'.repeat(5000) };

  it('replaces {{name}} with optional spaces in string values only, never in keys', () => {
    expect(renderLocally({ '{{a}}': '{{a}}-{{ a }}-{{  b}}', n: 5, t: true, z: null, arr: ['{{a}}'] }, values)).toEqual({
      '{{a}}': 'X-X-{{a}}', n: 5, t: true, z: null, arr: ['X'],
    });
  });

  it('is single pass: an inserted value that looks like a placeholder is never expanded', () => {
    expect(renderLocally({ x: 'v={{b}}' }, values)).toEqual({ x: 'v={{a}}' });
  });

  it('leaves a {{ whose }} is on a later line literal, like the server', () => {
    expect(renderLocally({ x: '{{a\n}} {{a}}' }, values)).toEqual({ x: '{{a\n}} X' });
  });

  it('refuses a reference to an undefined variable and prototype names', () => {
    expect(() => renderLocally({ x: '{{zzz}}' }, values)).toThrow(/未定义的变量 \{\{zzz\}\}/);
    expect(() => renderLocally({ x: '{{__proto__}}' }, values)).toThrow(/未定义的变量/);
    expect(() => renderLocally({ x: '{{a.b}}' }, values)).toThrow(/未定义的变量/);
  });

  it('caps the rendered output at 2 MB and does it linearly (many placeholders, no quadratic work)', () => {
    const big = { s: '{{long}}'.repeat(500) }; // 2,500,000 characters
    expect(() => renderLocally(big, values)).toThrow(/渲染结果超过 2 MB 上限/);
    const many = { s: '{{a}}'.repeat(300_000) };
    const started = Date.now();
    expect((renderLocally(many, values) as { s: string }).s).toHaveLength(300_000);
    expect(Date.now() - started).toBeLessThan(2000);
    const unclosed = { s: '{{a '.repeat(300_000) };
    const t2 = Date.now();
    renderLocally(unclosed, values);
    expect(Date.now() - t2).toBeLessThan(2000);
  });

  it('refuses content nested deeper than the server allows', () => {
    let nested: unknown = 'x';
    for (let i = 0; i < 60; i++) nested = [nested];
    expect(() => renderLocally(nested, values)).toThrow(/嵌套超过 40 层/);
  });
});
