/**
 * Variable values for `template use` / `package use` / `upgrade --preview`: `--var name=value` (repeatable) or
 * `--vars-file vars.json`. Only the shape is checked here (name syntax, scalar, <=50 values, <=5000 chars, no NUL);
 * type / enum / required rules need the version's definitions and live in localRender.ts (dry-run) or the server.
 */

import { InputError, parseId } from '../../utils/cliHelpers';
import { MAX_VARIABLES, parseJsonText, readJsonFile } from './jsonInput';

export const MAX_VALUE_LENGTH = 5000;
export const MAX_VARS_FILE_BYTES = 1024 * 1024;
export const MAX_ITEMS_OVERRIDDEN = 20;
export const VAR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;

export type VarValue = string | number | boolean | null;
export type VarMap = Record<string, VarValue>;

export interface VarFlags {
  var?: string[];
  varsFile?: string;
}

const shorten = (text: string) => (text.length <= 40 ? text : `${text.slice(0, 40)}…`);

export function checkVarName(name: string, at: string): string {
  if (!VAR_NAME.test(name)) {
    throw new InputError(`${at}: "${shorten(name)}" 不是合法的变量名（字母开头，字母 / 数字 / 下划线，最长 50）`);
  }
  return name;
}

/** Same limits as the server: <=5000 characters, and NUL cannot be stored by PostgreSQL. */
export function checkVarValue(value: string, at: string): string {
  if (value.length > MAX_VALUE_LENGTH) throw new InputError(`${at}: 值最多 ${MAX_VALUE_LENGTH} 个字符，当前 ${value.length} 个`);
  if (value.includes('\u0000')) throw new InputError(`${at}: 值不能包含 NUL 字符`);
  return value;
}

/** `name=value` split at the first `=` (the value may contain more). */
function splitPair(raw: string, flag: string): [string, string] {
  const at = raw.indexOf('=');
  if (at <= 0) throw new InputError(`${flag} 必须是 name=value 格式，收到: ${shorten(raw)}`);
  return [checkVarName(raw.slice(0, at).trim(), flag), checkVarValue(raw.slice(at + 1), `${flag} ${shorten(raw.slice(0, at))}`)];
}

function pairsToMap(pairs: Array<[string, string]>, flag: string): VarMap {
  const names = pairs.map(([name]) => name);
  const duplicate = names.find((name, i) => names.indexOf(name) !== i);
  if (duplicate) throw new InputError(`${flag} 变量 ${duplicate} 重复`);
  if (pairs.length > MAX_VARIABLES) throw new InputError(`${flag} 最多 ${MAX_VARIABLES} 个变量，当前 ${pairs.length} 个`);
  return Object.fromEntries(pairs);
}

export function parseVarFlags(raw: string[], flag = '--var'): VarMap {
  return pairsToMap(raw.map((r) => splitPair(r, flag)), flag);
}

/** A JSON number that is not exactly what the user wrote (1e21, 12345678901234567890) is refused: pass it as a string. */
function fileValue(name: string, value: unknown): VarValue {
  const at = `--vars-file 的 ${name}`;
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return checkVarValue(value, at);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || /e/i.test(String(value)) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new InputError(`${at}: 数值超出可精确表示的范围，请改写成字符串（如 "123456789012345678901"）`);
    }
    return value;
  }
  throw new InputError(`${at}: 值必须是字符串、数字或布尔值`);
}

/** File: a flat JSON object `{name: scalar}`, <=1 MB, depth <=32, no exponent numbers; a non-regular file is refused. */
export function loadVarsFile(file: string, flag = '--vars-file'): VarMap {
  const parsed = parseJsonText(readJsonFile(file, flag, MAX_VARS_FILE_BYTES), flag, true);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InputError(`${flag}: 必须是 JSON 对象 {"变量名": 值}`);
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > MAX_VARIABLES) throw new InputError(`${flag}: 最多 ${MAX_VARIABLES} 个变量，当前 ${entries.length} 个`);
  return Object.fromEntries(entries.map(([name, value]) => [checkVarName(name, `${flag} 的键`), fileValue(name, value)]));
}

/** `--var` and `--vars-file` are alternatives; neither given = no variables. */
export function resolveVariables(o: VarFlags): VarMap | undefined {
  if (o.var?.length && o.varsFile !== undefined) throw new InputError('--var 与 --vars-file 不能同时使用');
  if (o.varsFile !== undefined) return loadVarsFile(o.varsFile);
  return o.var?.length ? parseVarFlags(o.var) : undefined;
}

export interface ItemOverride {
  templateId: number;
  variables: VarMap;
}

/** `--item <templateId>:<name>=<value>` (repeatable) -> one override per template, in first-seen order. */
export function parseItemOverrides(raw: string[]): ItemOverride[] {
  const pairs = raw.map((entry) => {
    const colon = entry.indexOf(':');
    if (colon <= 0) throw new InputError(`--item 必须是 <templateId>:<name>=<value> 格式，收到: ${shorten(entry)}`);
    const [name, value] = splitPair(entry.slice(colon + 1), '--item');
    return { templateId: parseId(entry.slice(0, colon), '--item 的 templateId'), name, value };
  });
  const ids = Array.from(new Set(pairs.map((p) => p.templateId)));
  if (ids.length > MAX_ITEMS_OVERRIDDEN) throw new InputError(`--item 最多覆盖 ${MAX_ITEMS_OVERRIDDEN} 个模板，当前 ${ids.length} 个`);
  return ids.map((templateId) => ({
    templateId,
    variables: pairsToMap(pairs.filter((p) => p.templateId === templateId).map((p): [string, string] => [p.name, p.value]), `--item ${templateId}:`),
  }));
}
