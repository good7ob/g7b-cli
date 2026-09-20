/** Rendered template output (instance / upgrade preview / dry-run): a document body, or structured JSON. */
/** Document templates render to `{format, body}`; anything else has no top-level text body. */
export declare function documentBody(rendered: unknown): {
    format: string;
    body: string;
} | undefined;
/** What `--out` writes: the document body itself, or the rendered JSON of a structured template. */
export declare function outText(rendered: unknown): string;
/**
 * The rendered result for a terminal: a document body in full, structured content as its first lines, or (with
 * `writtenTo`) just a pointer to the file it went to. The body is untrusted text, sanitised by `emit`.
 */
export declare function resultLines(rendered: unknown, writtenTo?: string): string[];
//# sourceMappingURL=renderBody.d.ts.map