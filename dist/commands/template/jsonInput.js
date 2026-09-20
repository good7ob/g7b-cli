"use strict";
/**
 * Local guard for the attacker-controllable JSON that goes into a template version (`content`, `variables`,
 * `compatibility`). Mirrors the server's TemplateJsonGuard (api-0091 §1) so an oversize / too-deep document is
 * refused here with a clear message instead of being uploaded and answered with 1001.
 *
 * The scan is iterative and runs on the raw text BEFORE JSON.parse: JSON.parse itself recurses, so a
 * `[[[[…` bomb must never reach it.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkCompatibility = exports.checkVariables = exports.checkContent = exports.loadJson = exports.readJsonFile = exports.parseJsonText = exports.scanJsonLimits = exports.MAX_FILE_BYTES = exports.MAX_VARIABLES = exports.MAX_COMPATIBILITY_BYTES = exports.MAX_CONTENT_BYTES = exports.MAX_CONTAINER_SIZE = exports.MAX_NODES = exports.MAX_DEPTH = void 0;
const fs = __importStar(require("fs"));
const cliHelpers_1 = require("../../utils/cliHelpers");
exports.MAX_DEPTH = 32;
exports.MAX_NODES = 50000;
exports.MAX_CONTAINER_SIZE = 10000;
exports.MAX_CONTENT_BYTES = 1024 * 1024;
exports.MAX_COMPATIBILITY_BYTES = 4096;
exports.MAX_VARIABLES = 50;
/** Raw cap on what we are willing to read from disk (a pretty-printed 1 MB document is larger than 1 MB). */
exports.MAX_FILE_BYTES = 8 * 1024 * 1024;
const WS = new Set([' ', '\t', '\n', '\r']);
const STOPS = new Set([',', ']', '}', '[', '{', ':', '"', ' ', '\t', '\n', '\r']);
/**
 * Throws InputError when `text` exceeds depth / node / per-container limits. Malformed JSON is left to JSON.parse.
 * `plainNumbers` additionally refuses exponent notation (1e5): used where a number becomes a template variable.
 */
function scanJsonLimits(text, label, plainNumbers = false) {
    const elements = new Int32Array(exports.MAX_DEPTH + 2);
    let depth = 0;
    let nodes = 0;
    const value = () => {
        if (++nodes > exports.MAX_NODES)
            throw new cliHelpers_1.InputError(`${label}: 内容的值超过 ${exports.MAX_NODES} 个`);
        if (depth > 0 && ++elements[depth] > exports.MAX_CONTAINER_SIZE) {
            throw new cliHelpers_1.InputError(`${label}: 数组或对象的元素超过 ${exports.MAX_CONTAINER_SIZE} 个`);
        }
    };
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (WS.has(c) || c === ',' || c === ':') {
            i++;
        }
        else if (c === '{' || c === '[') {
            value();
            if (++depth > exports.MAX_DEPTH)
                throw new cliHelpers_1.InputError(`${label}: 嵌套超过 ${exports.MAX_DEPTH} 层`);
            elements[depth] = 0;
            i++;
        }
        else if (c === '}' || c === ']') {
            if (depth > 0)
                depth--;
            i++;
        }
        else if (c === '"') {
            let j = i + 1;
            while (j < text.length && text[j] !== '"')
                j += text[j] === '\\' ? 2 : 1;
            let k = j + 1;
            while (k < text.length && WS.has(text[k]))
                k++;
            if (text[k] !== ':')
                value(); // a string followed by ':' is an object key, not a value
            i = j + 1;
        }
        else {
            let j = i;
            while (j < text.length && !STOPS.has(text[j]))
                j++;
            const token = text.slice(i, j);
            // 1e999 parses to Infinity and would be serialised as null: refuse instead of silently changing the document
            if (/^-?[0-9]/.test(token) && !Number.isFinite(Number(token))) {
                throw new cliHelpers_1.InputError(`${label}: 数字超出可表示范围: ${token.slice(0, 30)}`);
            }
            if (plainNumbers && /^-?[0-9]/.test(token) && /[eE]/.test(token)) {
                throw new cliHelpers_1.InputError(`${label}: 数值请用普通小数写法，不支持指数: ${token.slice(0, 30)}`);
            }
            value();
            i = j;
        }
    }
}
exports.scanJsonLimits = scanJsonLimits;
/** Scan, then parse. Any failure is an InputError naming `label`. */
function parseJsonText(text, label, plainNumbers = false) {
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    scanJsonLimits(clean, label, plainNumbers);
    try {
        return JSON.parse(clean);
    }
    catch (error) {
        throw new cliHelpers_1.InputError(`${label}: 不是合法的 JSON（${error.message}）`);
    }
}
exports.parseJsonText = parseJsonText;
/**
 * Read a JSON file. Only a regular file is accepted (a FIFO / device / directory could hang or
 * exhaust memory); the check is made on the opened descriptor so the file cannot be swapped in between.
 */
function readJsonFile(path, flag, maxBytes = exports.MAX_FILE_BYTES) {
    let fd;
    try {
        // O_NONBLOCK: opening a FIFO must not block waiting for a writer
        fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
        const stat = fs.fstatSync(fd);
        if (!stat.isFile())
            throw new cliHelpers_1.InputError(`${flag} 必须指向普通文件: ${path}`);
        if (stat.size > maxBytes) {
            throw new cliHelpers_1.InputError(`${flag} 文件过大（${stat.size} 字节，上限 ${maxBytes}）: ${path}`);
        }
        return fs.readFileSync(fd, 'utf-8');
    }
    catch (error) {
        if (error instanceof cliHelpers_1.InputError)
            throw error;
        throw new cliHelpers_1.InputError(`${flag} 无法读取 ${path}: ${error.code ?? error.message}`);
    }
    finally {
        if (fd !== undefined)
            fs.closeSync(fd);
    }
}
exports.readJsonFile = readJsonFile;
/** `--x-file` / `--x` (mutually exclusive) -> parsed JSON, or undefined when neither was given. */
function loadJson(source, fileFlag, inlineFlag, label) {
    if (source.file !== undefined && source.inline !== undefined) {
        throw new cliHelpers_1.InputError(`${fileFlag} 与 ${inlineFlag} 不能同时使用`);
    }
    if (source.file !== undefined)
        return parseJsonText(readJsonFile(source.file, fileFlag), label);
    if (source.inline !== undefined)
        return parseJsonText(source.inline, label);
    return undefined;
}
exports.loadJson = loadJson;
const compactBytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf-8');
/** `content` must be a JSON object and at most 1 MB once serialised compactly (as the server measures it). */
function checkContent(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new cliHelpers_1.InputError('content: 必须是 JSON 对象');
    }
    const bytes = compactBytes(value);
    if (bytes > exports.MAX_CONTENT_BYTES) {
        throw new cliHelpers_1.InputError(`content: 序列化后 ${bytes} 字节，超过上限 ${exports.MAX_CONTENT_BYTES}（1 MB）`);
    }
    return value;
}
exports.checkContent = checkContent;
/** `variables` must be an array of at most 50 items (name/type rules are the server's: it answers 1001 with the JSON path). */
function checkVariables(value) {
    if (!Array.isArray(value))
        throw new cliHelpers_1.InputError('variables: 必须是 JSON 数组');
    if (value.length > exports.MAX_VARIABLES)
        throw new cliHelpers_1.InputError(`variables: 最多 ${exports.MAX_VARIABLES} 个，当前 ${value.length} 个`);
    return value;
}
exports.checkVariables = checkVariables;
function checkCompatibility(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new cliHelpers_1.InputError('compatibility: 必须是 JSON 对象');
    }
    const bytes = compactBytes(value);
    if (bytes > exports.MAX_COMPATIBILITY_BYTES) {
        throw new cliHelpers_1.InputError(`compatibility: 序列化后 ${bytes} 字节，超过上限 ${exports.MAX_COMPATIBILITY_BYTES}`);
    }
    return value;
}
exports.checkCompatibility = checkCompatibility;
//# sourceMappingURL=jsonInput.js.map