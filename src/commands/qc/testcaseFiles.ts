/**
 * Pure helpers for `good7ob qc testcase` — step parsing and .feature upload planning.
 * Kept free of apiClient so they can be unit tested directly.
 */

import fs from 'fs';
import path from 'path';

/** Backend limit per import request (api-0082 §5). */
export const MAX_FILES_PER_REQUEST = 50;

export interface TestStepInput {
  action: string;
  expected: string;
}

export interface UploadBatch {
  /** Script path prefix sent as `basePath`; scriptPath = basePath + file name. */
  basePath: string;
  files: string[];
}

/** "操作::预期" → { action, expected }; without "::" the whole text is the action. */
export function parseStep(raw: string): TestStepInput {
  const idx = raw.indexOf('::');
  if (idx < 0) return { action: raw.trim(), expected: '' };
  return { action: raw.slice(0, idx).trim(), expected: raw.slice(idx + 2).trim() };
}

/** Expand files/directories into absolute .feature paths (recursive, skips dot-dirs and node_modules). */
export function collectFeatureFiles(inputs: string[]): string[] {
  const found = new Set<string>();
  const walk = (p: string): void => {
    if (fs.statSync(p).isDirectory()) {
      for (const entry of fs.readdirSync(p)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        walk(path.join(p, entry));
      }
    } else if (p.endsWith('.feature')) {
      found.add(path.resolve(p));
    }
  };
  inputs.forEach(walk);
  return [...found].sort();
}

/**
 * Group files by directory relative to `root`, so the stored script path equals the repo path
 * (the backend dedupes re-imports on it), then split into ≤50-file requests.
 * `basePathOverride` puts every file under one explicit prefix instead.
 */
export function planBatches(files: string[], root: string, basePathOverride?: string): UploadBatch[] {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    let dir: string;
    if (basePathOverride !== undefined) {
      dir = basePathOverride;
    } else {
      dir = path.relative(root, path.dirname(file));
      if (dir.startsWith('..') || path.isAbsolute(dir)) {
        throw new Error(`文件不在 --root 目录下: ${file}`);
      }
    }
    const key = normalizeBasePath(dir);
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }

  const batches: UploadBatch[] = [];
  for (const [basePath, list] of groups) {
    for (let i = 0; i < list.length; i += MAX_FILES_PER_REQUEST) {
      batches.push({ basePath, files: list.slice(i, i + MAX_FILES_PER_REQUEST) });
    }
  }
  return batches;
}

function normalizeBasePath(dir: string): string {
  const posix = dir.replace(/\\/g, '/').replace(/^\.(\/|$)/, '').replace(/^\/+/, '');
  return posix === '' || posix.endsWith('/') ? posix : `${posix}/`;
}
