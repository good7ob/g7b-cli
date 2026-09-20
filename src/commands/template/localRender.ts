/**
 * Client-side mirror of the server's variable rules and TemplateRenderer (api-0091 §12), used by
 * `template use --dry-run` to preview an instantiation without creating anything.
 *
 * Plain text substitution of `{{name}}` in the string VALUES of the content (keys never), one pass: a substituted
 * value is never scanned again. No expressions, no evaluation, no network / file access. The rendered output is
 * capped at 2 MB. The server still re-validates the rendered content per template type; this is a preview.
 */

import { InputError, parseDate } from '../../utils/cliHelpers';
import { VariableDef } from './renderVersion';
import { MAX_VARIABLES } from './jsonInput';
import { MAX_VALUE_LENGTH, VarMap, VarValue } from './varsInput';

export const MAX_RENDERED_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 40;
const MAX_DECIMAL_TEXT = 64;
const MAX_DECIMAL_DIGITS = 30;
const PLAIN_DECIMAL = /^(-?)([0-9]+)(?:\.([0-9]+))?$/;

export interface ResolvedVariables {
  /** what gets substituted, by name ("" for an optional variable without a value) */
  text: Record<string, string>;
  /** the normalized typed values (defaults filled in), as the server stores them */
  typed: Record<string, string | number | boolean>;
}

const overBudget = () => new InputError('渲染结果超过 2 MB 上限');

/** Plain decimal only (no exponent, no `+`): `007` -> `7`, `-0.0` -> `0.0`, at most 30 integer / 30 fraction digits. */
function decimalText(raw: VarValue, at: string): string {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
  const m = text.length <= MAX_DECIMAL_TEXT ? PLAIN_DECIMAL.exec(text) : null;
  if (!m) throw new InputError(`${at}: 必须是普通小数（如 12 或 -3.5），不支持指数写法（1e5）`);
  const integer = m[2].replace(/^0+(?=[0-9])/, '');
  const fraction = m[3] ?? '';
  if (integer.length > MAX_DECIMAL_DIGITS || fraction.length > MAX_DECIMAL_DIGITS) throw new InputError(`${at}: 数值超出允许范围`);
  const negative = m[1] === '-' && /[1-9]/.test(integer + fraction);
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

function coerce(def: VariableDef, raw: VarValue): string | number | boolean {
  const at = `变量 ${def.name}`;
  switch (def.type) {
    case 'number': {
      const text = decimalText(raw, at);
      return String(Number(text)) === text ? Number(text) : text;
    }
    case 'boolean': {
      const flag = typeof raw === 'string' ? raw.toLowerCase() : raw;
      if (flag !== true && flag !== false && flag !== 'true' && flag !== 'false') throw new InputError(`${at}: 必须是 true 或 false`);
      return flag === true || flag === 'true';
    }
    case 'date':
      return parseDate(typeof raw === 'string' ? raw : '', at);
    case 'enum':
      if (typeof raw !== 'string' || !(def.options ?? []).includes(raw)) {
        throw new InputError(`${at}: 必须是 ${JSON.stringify((def.options ?? []).slice(0, 10))} 之一`);
      }
      return raw;
    default:
      if (typeof raw !== 'string') throw new InputError(`${at}: 必须是字符串`);
      return raw;
  }
}

/** Validate `input` against the version's definitions and fill in defaults, exactly like the server. */
export function resolveAgainstDefs(defs: VariableDef[], input: VarMap | undefined): ResolvedVariables {
  const given = input ?? {};
  const known = new Set(defs.map((d) => String(d.name)));
  const unknown = Object.keys(given).find((name) => !known.has(name));
  if (unknown !== undefined) throw new InputError(`变量 ${unknown} 未在该模板版本中定义（已定义: ${Array.from(known).join(', ') || '无'}）`);
  if (Object.keys(given).length > MAX_VARIABLES) throw new InputError(`变量最多 ${MAX_VARIABLES} 个`);

  const text: Record<string, string> = {};
  const typed: Record<string, string | number | boolean> = {};
  const missing: string[] = [];
  defs.forEach((def) => {
    const name = String(def.name);
    const supplied = given[name];
    const raw: VarValue | undefined = supplied ?? (def.default as VarValue | undefined);
    if (raw === null || raw === undefined) {
      text[name] = '';
      if (def.required) missing.push(name);
      return;
    }
    const value = coerce(def, raw);
    const rendered = String(value);
    if (rendered.length > MAX_VALUE_LENGTH) throw new InputError(`变量 ${name}: 长度不能超过 ${MAX_VALUE_LENGTH} 个字符`);
    if (rendered.includes('\u0000')) throw new InputError(`变量 ${name}: 不能包含 NUL 字符`);
    if (def.required && !rendered.trim()) missing.push(name);
    text[name] = rendered;
    typed[name] = value;
  });
  if (missing.length) throw new InputError(`缺少必填变量: ${missing.join(', ')}`);
  return { text, typed };
}

/** `{{ name }}` occurrences in one string; a `{{` whose `}}` is on a later line is literal (as on the server). */
function substituteText(input: string, values: Record<string, string>, budget: { left: number }): string {
  const pieces: string[] = [];
  let copied = 0;
  let from = 0;
  let close = -2;
  let newline = -2;
  for (;;) {
    const open = input.indexOf('{{', from);
    if (open < 0) break;
    if (close !== -1 && close < open + 2) close = input.indexOf('}}', open + 2);
    if (close < 0) break;
    if (newline !== -1 && newline < open + 2) newline = input.indexOf('\n', open + 2);
    if (newline >= 0 && newline < close) {
      from = open + 2;
      continue;
    }
    const name = input.slice(open + 2, close).trim();
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new InputError(`模板内容引用了未定义的变量 {{${name.length > 40 ? `${name.slice(0, 40)}…` : name}}}`);
    }
    pieces.push(input.slice(copied, open), values[name]);
    budget.left -= open - copied + values[name].length;
    if (budget.left < 0) throw overBudget();
    copied = close + 2;
    from = copied;
  }
  pieces.push(input.slice(copied));
  budget.left -= input.length - copied;
  if (budget.left < 0) throw overBudget();
  return pieces.join('');
}

function substitute(node: unknown, values: Record<string, string>, budget: { left: number }, depth: number): unknown {
  if (depth > MAX_DEPTH) throw new InputError(`模板内容嵌套超过 ${MAX_DEPTH} 层`);
  if (typeof node === 'string') return substituteText(node, values, budget);
  if (Array.isArray(node)) return node.map((child) => substitute(child, values, budget, depth + 1));
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, substitute(child, values, budget, depth + 1)]));
  }
  return node;
}

/** Substitute the resolved values into `content` (a fresh copy); throws when the result exceeds 2 MB. */
export function renderLocally(content: unknown, values: Record<string, string>): unknown {
  const rendered = substitute(content, values, { left: MAX_RENDERED_BYTES }, 0);
  if (Buffer.byteLength(JSON.stringify(rendered), 'utf-8') > MAX_RENDERED_BYTES) throw overBudget();
  return rendered;
}
