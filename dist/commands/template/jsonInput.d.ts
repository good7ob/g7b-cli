/**
 * Local guard for the attacker-controllable JSON that goes into a template version (`content`, `variables`,
 * `compatibility`). Mirrors the server's TemplateJsonGuard (api-0091 §1) so an oversize / too-deep document is
 * refused here with a clear message instead of being uploaded and answered with 1001.
 *
 * The scan is iterative and runs on the raw text BEFORE JSON.parse: JSON.parse itself recurses, so a
 * `[[[[…` bomb must never reach it.
 */
export declare const MAX_DEPTH = 32;
export declare const MAX_NODES = 50000;
export declare const MAX_CONTAINER_SIZE = 10000;
export declare const MAX_CONTENT_BYTES: number;
export declare const MAX_COMPATIBILITY_BYTES = 4096;
export declare const MAX_VARIABLES = 50;
/** Raw cap on what we are willing to read from disk (a pretty-printed 1 MB document is larger than 1 MB). */
export declare const MAX_FILE_BYTES: number;
/** Throws InputError when `text` exceeds depth / node / per-container limits. Malformed JSON is left to JSON.parse. */
export declare function scanJsonLimits(text: string, label: string): void;
/** Scan, then parse. Any failure is an InputError naming `label`. */
export declare function parseJsonText(text: string, label: string): unknown;
/**
 * Read a JSON file. Only a regular file is accepted (a FIFO / device / directory could hang or
 * exhaust memory); the check is made on the opened descriptor so the file cannot be swapped in between.
 */
export declare function readJsonFile(path: string, flag: string): string;
export interface JsonSource {
    file?: string;
    inline?: string;
}
/** `--x-file` / `--x` (mutually exclusive) -> parsed JSON, or undefined when neither was given. */
export declare function loadJson(source: JsonSource, fileFlag: string, inlineFlag: string, label: string): unknown;
/** `content` must be a JSON object and at most 1 MB once serialised compactly (as the server measures it). */
export declare function checkContent(value: unknown): Record<string, unknown>;
/** `variables` must be an array of at most 50 items (name/type rules are the server's: it answers 1001 with the JSON path). */
export declare function checkVariables(value: unknown): unknown[];
export declare function checkCompatibility(value: unknown): Record<string, unknown>;
//# sourceMappingURL=jsonInput.d.ts.map