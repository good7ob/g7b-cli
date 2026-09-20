/**
 * `--out <file>` for rendered template output. The path is checked BEFORE any request (an instantiation must not
 * succeed only for the result to be unwritable), and the write itself re-checks atomically: no overwriting without
 * `--force`, regular files only (no symlink, directory, FIFO or device), nothing outside an existing directory.
 */
/** Flags that go with every `--out`. */
export interface OutFlags {
    out?: string;
    force?: boolean;
}
/** Absolute target path, or undefined when `--out` was not given. Throws InputError for an unusable path. */
export declare function checkOutTarget(o: OutFlags): string | undefined;
/**
 * Write `text` (plus a final newline). Without `force` the file is created exclusively (O_EXCL), so a file that
 * appeared since the pre-check is never touched; with `force` a symlink is still refused (O_NOFOLLOW) and the opened
 * descriptor must be a regular file before it is truncated.
 */
export declare function writeOutFile(file: string, text: string, force?: boolean): void;
export interface OutTarget {
    file?: string;
    force?: boolean;
    /** the rendered content `--out` writes */
    content: unknown;
    /** shown when the write fails AFTER the server already did its work */
    failPrefix: string;
}
/**
 * Write `--out` (if any), print the result, and only then report a write failure: the objects were already created
 * (or the preview already rendered), so the user must still see what happened before the non-zero exit.
 */
export declare function emitWithOut(json: boolean | undefined, data: unknown, render: (writtenTo?: string) => string, target: OutTarget): void;
//# sourceMappingURL=outFile.d.ts.map