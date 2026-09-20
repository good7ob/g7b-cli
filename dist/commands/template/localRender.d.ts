/**
 * Client-side mirror of the server's variable rules and TemplateRenderer (api-0091 §12), used by
 * `template use --dry-run` to preview an instantiation without creating anything.
 *
 * Plain text substitution of `{{name}}` in the string VALUES of the content (keys never), one pass: a substituted
 * value is never scanned again. No expressions, no evaluation, no network / file access. The rendered output is
 * capped at 2 MB. The server still re-validates the rendered content per template type; this is a preview.
 */
import { VariableDef } from './renderVersion';
import { VarMap } from './varsInput';
export declare const MAX_RENDERED_BYTES: number;
export interface ResolvedVariables {
    /** what gets substituted, by name ("" for an optional variable without a value) */
    text: Record<string, string>;
    /** the normalized typed values (defaults filled in), as the server stores them */
    typed: Record<string, string | number | boolean>;
}
/** Validate `input` against the version's definitions and fill in defaults, exactly like the server. */
export declare function resolveAgainstDefs(defs: VariableDef[], input: VarMap | undefined): ResolvedVariables;
/** Substitute the resolved values into `content` (a fresh copy); throws when the result exceeds 2 MB. */
export declare function renderLocally(content: unknown, values: Record<string, string>): unknown;
//# sourceMappingURL=localRender.d.ts.map