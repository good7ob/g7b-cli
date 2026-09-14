"use strict";
/**
 * Pure helpers for `good7ob qc testcase` — step parsing and .feature upload planning.
 * Kept free of apiClient so they can be unit tested directly.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.planBatches = exports.collectFeatureFiles = exports.parseStep = exports.MAX_FILES_PER_REQUEST = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/** Backend limit per import request (api-0082 §5). */
exports.MAX_FILES_PER_REQUEST = 50;
/** "操作::预期" → { action, expected }; without "::" the whole text is the action. */
function parseStep(raw) {
    const idx = raw.indexOf('::');
    if (idx < 0)
        return { action: raw.trim(), expected: '' };
    return { action: raw.slice(0, idx).trim(), expected: raw.slice(idx + 2).trim() };
}
exports.parseStep = parseStep;
/** Expand files/directories into absolute .feature paths (recursive, skips dot-dirs and node_modules). */
function collectFeatureFiles(inputs) {
    const found = new Set();
    const walk = (p) => {
        if (fs_1.default.statSync(p).isDirectory()) {
            for (const entry of fs_1.default.readdirSync(p)) {
                if (entry === 'node_modules' || entry.startsWith('.'))
                    continue;
                walk(path_1.default.join(p, entry));
            }
        }
        else if (p.endsWith('.feature')) {
            found.add(path_1.default.resolve(p));
        }
    };
    inputs.forEach(walk);
    return [...found].sort();
}
exports.collectFeatureFiles = collectFeatureFiles;
/**
 * Group files by directory relative to `root`, so the stored script path equals the repo path
 * (the backend dedupes re-imports on it), then split into ≤50-file requests.
 * `basePathOverride` puts every file under one explicit prefix instead.
 */
function planBatches(files, root, basePathOverride) {
    const groups = new Map();
    for (const file of files) {
        let dir;
        if (basePathOverride !== undefined) {
            dir = basePathOverride;
        }
        else {
            dir = path_1.default.relative(root, path_1.default.dirname(file));
            if (dir.startsWith('..') || path_1.default.isAbsolute(dir)) {
                throw new Error(`文件不在 --root 目录下: ${file}`);
            }
        }
        const key = normalizeBasePath(dir);
        groups.set(key, [...(groups.get(key) ?? []), file]);
    }
    const batches = [];
    for (const [basePath, list] of groups) {
        for (let i = 0; i < list.length; i += exports.MAX_FILES_PER_REQUEST) {
            batches.push({ basePath, files: list.slice(i, i + exports.MAX_FILES_PER_REQUEST) });
        }
    }
    return batches;
}
exports.planBatches = planBatches;
function normalizeBasePath(dir) {
    const posix = dir.replace(/\\/g, '/').replace(/^\.(\/|$)/, '').replace(/^\/+/, '');
    return posix === '' || posix.endsWith('/') ? posix : `${posix}/`;
}
//# sourceMappingURL=testcaseFiles.js.map