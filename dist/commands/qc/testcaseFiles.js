"use strict";
/**
 * Pure helpers for `good7ob qc testcase` — step parsing and .feature upload planning.
 * Kept free of apiClient so they can be unit tested directly.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSuitePath = exports.readBatchFile = exports.planBatches = exports.collectFeatureFiles = exports.parseStep = exports.MAX_FILES_PER_REQUEST = void 0;
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
/** Read a create-batch file: a JSON array (or { "cases": [...] }) of cases with title + steps. */
function readBatchFile(file) {
    const parsed = JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    const cases = Array.isArray(parsed) ? parsed : parsed?.cases;
    if (!Array.isArray(cases) || cases.length === 0) {
        throw new Error('文件须为非空 JSON 数组，或 { "cases": [...] }');
    }
    cases.forEach((c, i) => {
        if (!c || typeof c.title !== 'string' || !c.title.trim())
            throw new Error(`第 ${i + 1} 条缺少 title`);
        if (!Array.isArray(c.steps) || c.steps.length === 0)
            throw new Error(`第 ${i + 1} 条缺少 steps: ${c.title}`);
    });
    return cases;
}
exports.readBatchFile = readBatchFile;
/**
 * Resolve "一级/二级" to a suite id, creating missing levels through `create`.
 * `suites` is the caller's cache of the product's suites and gains every created suite,
 * so later cases in the same batch reuse them instead of creating duplicates.
 */
async function ensureSuitePath(suitePath, suites, create) {
    let parentId = null;
    for (const name of suitePath.split('/').map((s) => s.trim()).filter(Boolean)) {
        let found = suites.find((s) => (s.parentId ?? null) === parentId && s.name === name);
        if (!found) {
            found = await create(name, parentId);
            suites.push(found);
        }
        parentId = found.id;
    }
    if (parentId === null)
        throw new Error(`目录路径为空: "${suitePath}"`);
    return parentId;
}
exports.ensureSuitePath = ensureSuitePath;
function normalizeBasePath(dir) {
    const posix = dir.replace(/\\/g, '/').replace(/^\.(\/|$)/, '').replace(/^\/+/, '');
    return posix === '' || posix.endsWith('/') ? posix : `${posix}/`;
}
//# sourceMappingURL=testcaseFiles.js.map