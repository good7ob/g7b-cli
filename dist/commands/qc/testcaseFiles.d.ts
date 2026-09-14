/**
 * Pure helpers for `good7ob qc testcase` — step parsing and .feature upload planning.
 * Kept free of apiClient so they can be unit tested directly.
 */
/** Backend limit per import request (api-0082 §5). */
export declare const MAX_FILES_PER_REQUEST = 50;
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
export declare function parseStep(raw: string): TestStepInput;
/** Expand files/directories into absolute .feature paths (recursive, skips dot-dirs and node_modules). */
export declare function collectFeatureFiles(inputs: string[]): string[];
/**
 * Group files by directory relative to `root`, so the stored script path equals the repo path
 * (the backend dedupes re-imports on it), then split into ≤50-file requests.
 * `basePathOverride` puts every file under one explicit prefix instead.
 */
export declare function planBatches(files: string[], root: string, basePathOverride?: string): UploadBatch[];
//# sourceMappingURL=testcaseFiles.d.ts.map