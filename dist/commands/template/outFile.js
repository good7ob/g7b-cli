"use strict";
/**
 * `--out <file>` for rendered template output. The path is checked BEFORE any request (an instantiation must not
 * succeed only for the result to be unwritable), and the write itself re-checks atomically: no overwriting without
 * `--force`, regular files only (no symlink, directory, FIFO or device), nothing outside an existing directory.
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
exports.emitWithOut = exports.writeOutFile = exports.checkOutTarget = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const renderBody_1 = require("./renderBody");
/** Absolute target path, or undefined when `--out` was not given. Throws InputError for an unusable path. */
function checkOutTarget(o) {
    if (o.force && o.out === undefined)
        throw new cliHelpers_1.InputError('--force 只能与 --out 一起使用');
    if (o.out === undefined)
        return undefined;
    if (!o.out.trim())
        throw new cliHelpers_1.InputError('--out 不能为空');
    const file = path.resolve(o.out);
    const dir = path.dirname(file);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
        throw new cliHelpers_1.InputError(`--out 的目录不存在: ${dir}`);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat)
        return file;
    if (stat.isSymbolicLink())
        throw new cliHelpers_1.InputError(`--out 不能是符号链接: ${file}`);
    if (!stat.isFile())
        throw new cliHelpers_1.InputError(`--out 必须是普通文件路径（不能是目录 / 设备 / 管道）: ${file}`);
    if (!o.force)
        throw new cliHelpers_1.InputError(`--out 文件已存在，不会覆盖: ${file}（确认要覆盖请加 --force）`);
    return file;
}
exports.checkOutTarget = checkOutTarget;
/**
 * Write `text` (plus a final newline). Without `force` the file is created exclusively (O_EXCL), so a file that
 * appeared since the pre-check is never touched; with `force` a symlink is still refused (O_NOFOLLOW) and the opened
 * descriptor must be a regular file before it is truncated.
 */
function writeOutFile(file, text, force) {
    const c = fs.constants;
    const flags = force
        ? c.O_WRONLY | c.O_CREAT | (c.O_NOFOLLOW ?? 0) | (c.O_NONBLOCK ?? 0)
        : c.O_WRONLY | c.O_CREAT | c.O_EXCL;
    const fd = fs.openSync(file, flags, 0o644);
    try {
        if (!fs.fstatSync(fd).isFile())
            throw new Error('不是普通文件');
        if (force)
            fs.ftruncateSync(fd, 0);
        fs.writeFileSync(fd, text.endsWith('\n') ? text : `${text}\n`);
    }
    finally {
        fs.closeSync(fd);
    }
}
exports.writeOutFile = writeOutFile;
/**
 * Write `--out` (if any), print the result, and only then report a write failure: the objects were already created
 * (or the preview already rendered), so the user must still see what happened before the non-zero exit.
 */
function emitWithOut(json, data, render, target) {
    let writtenTo;
    let failure;
    if (target.file) {
        try {
            writeOutFile(target.file, (0, renderBody_1.outText)(target.content), target.force);
            writtenTo = target.file;
        }
        catch (error) {
            failure = error;
        }
    }
    (0, cliHelpers_1.emit)(json, data, () => render(writtenTo));
    if (failure)
        (0, cliHelpers_1.fail)(target.failPrefix, failure);
}
exports.emitWithOut = emitWithOut;
//# sourceMappingURL=outFile.js.map