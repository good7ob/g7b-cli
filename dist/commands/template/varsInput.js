"use strict";
/**
 * Variable values for `template use` / `package use` / `upgrade --preview`: `--var name=value` (repeatable) or
 * `--vars-file vars.json`. Only the shape is checked here (name syntax, scalar, <=50 values, <=5000 chars, no NUL);
 * type / enum / required rules need the version's definitions and live in localRender.ts (dry-run) or the server.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseItemOverrides = exports.resolveVariables = exports.loadVarsFile = exports.parseVarFlags = exports.checkVarValue = exports.checkVarName = exports.VAR_NAME = exports.MAX_ITEMS_OVERRIDDEN = exports.MAX_VARS_FILE_BYTES = exports.MAX_VALUE_LENGTH = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
const jsonInput_1 = require("./jsonInput");
exports.MAX_VALUE_LENGTH = 5000;
exports.MAX_VARS_FILE_BYTES = 1024 * 1024;
exports.MAX_ITEMS_OVERRIDDEN = 20;
exports.VAR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;
const shorten = (text) => (text.length <= 40 ? text : `${text.slice(0, 40)}…`);
function checkVarName(name, at) {
    if (!exports.VAR_NAME.test(name)) {
        throw new cliHelpers_1.InputError(`${at}: "${shorten(name)}" 不是合法的变量名（字母开头，字母 / 数字 / 下划线，最长 50）`);
    }
    return name;
}
exports.checkVarName = checkVarName;
/** Same limits as the server: <=5000 characters, and NUL cannot be stored by PostgreSQL. */
function checkVarValue(value, at) {
    if (value.length > exports.MAX_VALUE_LENGTH)
        throw new cliHelpers_1.InputError(`${at}: 值最多 ${exports.MAX_VALUE_LENGTH} 个字符，当前 ${value.length} 个`);
    if (value.includes('\u0000'))
        throw new cliHelpers_1.InputError(`${at}: 值不能包含 NUL 字符`);
    return value;
}
exports.checkVarValue = checkVarValue;
/** `name=value` split at the first `=` (the value may contain more). */
function splitPair(raw, flag) {
    const at = raw.indexOf('=');
    if (at <= 0)
        throw new cliHelpers_1.InputError(`${flag} 必须是 name=value 格式，收到: ${shorten(raw)}`);
    return [checkVarName(raw.slice(0, at).trim(), flag), checkVarValue(raw.slice(at + 1), `${flag} ${shorten(raw.slice(0, at))}`)];
}
function pairsToMap(pairs, flag) {
    const names = pairs.map(([name]) => name);
    const duplicate = names.find((name, i) => names.indexOf(name) !== i);
    if (duplicate)
        throw new cliHelpers_1.InputError(`${flag} 变量 ${duplicate} 重复`);
    if (pairs.length > jsonInput_1.MAX_VARIABLES)
        throw new cliHelpers_1.InputError(`${flag} 最多 ${jsonInput_1.MAX_VARIABLES} 个变量，当前 ${pairs.length} 个`);
    return Object.fromEntries(pairs);
}
function parseVarFlags(raw, flag = '--var') {
    return pairsToMap(raw.map((r) => splitPair(r, flag)), flag);
}
exports.parseVarFlags = parseVarFlags;
/** A JSON number that is not exactly what the user wrote (1e21, 12345678901234567890) is refused: pass it as a string. */
function fileValue(name, value) {
    const at = `--vars-file 的 ${name}`;
    if (value === null)
        return null;
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string')
        return checkVarValue(value, at);
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || /e/i.test(String(value)) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
            throw new cliHelpers_1.InputError(`${at}: 数值超出可精确表示的范围，请改写成字符串（如 "123456789012345678901"）`);
        }
        return value;
    }
    throw new cliHelpers_1.InputError(`${at}: 值必须是字符串、数字或布尔值`);
}
/** File: a flat JSON object `{name: scalar}`, <=1 MB, depth <=32, no exponent numbers; a non-regular file is refused. */
function loadVarsFile(file, flag = '--vars-file') {
    const parsed = (0, jsonInput_1.parseJsonText)((0, jsonInput_1.readJsonFile)(file, flag, exports.MAX_VARS_FILE_BYTES), flag, true);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new cliHelpers_1.InputError(`${flag}: 必须是 JSON 对象 {"变量名": 值}`);
    }
    const entries = Object.entries(parsed);
    if (entries.length > jsonInput_1.MAX_VARIABLES)
        throw new cliHelpers_1.InputError(`${flag}: 最多 ${jsonInput_1.MAX_VARIABLES} 个变量，当前 ${entries.length} 个`);
    return Object.fromEntries(entries.map(([name, value]) => [checkVarName(name, `${flag} 的键`), fileValue(name, value)]));
}
exports.loadVarsFile = loadVarsFile;
/** `--var` and `--vars-file` are alternatives; neither given = no variables. */
function resolveVariables(o) {
    if (o.var?.length && o.varsFile !== undefined)
        throw new cliHelpers_1.InputError('--var 与 --vars-file 不能同时使用');
    if (o.varsFile !== undefined)
        return loadVarsFile(o.varsFile);
    return o.var?.length ? parseVarFlags(o.var) : undefined;
}
exports.resolveVariables = resolveVariables;
/** `--item <templateId>:<name>=<value>` (repeatable) -> one override per template, in first-seen order. */
function parseItemOverrides(raw) {
    const pairs = raw.map((entry) => {
        const colon = entry.indexOf(':');
        if (colon <= 0)
            throw new cliHelpers_1.InputError(`--item 必须是 <templateId>:<name>=<value> 格式，收到: ${shorten(entry)}`);
        const [name, value] = splitPair(entry.slice(colon + 1), '--item');
        return { templateId: (0, cliHelpers_1.parseId)(entry.slice(0, colon), '--item 的 templateId'), name, value };
    });
    const ids = Array.from(new Set(pairs.map((p) => p.templateId)));
    if (ids.length > exports.MAX_ITEMS_OVERRIDDEN)
        throw new cliHelpers_1.InputError(`--item 最多覆盖 ${exports.MAX_ITEMS_OVERRIDDEN} 个模板，当前 ${ids.length} 个`);
    return ids.map((templateId) => ({
        templateId,
        variables: pairsToMap(pairs.filter((p) => p.templateId === templateId).map((p) => [p.name, p.value]), `--item ${templateId}:`),
    }));
}
exports.parseItemOverrides = parseItemOverrides;
//# sourceMappingURL=varsInput.js.map