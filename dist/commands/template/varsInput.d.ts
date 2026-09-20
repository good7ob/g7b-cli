/**
 * Variable values for `template use` / `package use` / `upgrade --preview`: `--var name=value` (repeatable) or
 * `--vars-file vars.json`. Only the shape is checked here (name syntax, scalar, <=50 values, <=5000 chars, no NUL);
 * type / enum / required rules need the version's definitions and live in localRender.ts (dry-run) or the server.
 */
export declare const MAX_VALUE_LENGTH = 5000;
export declare const MAX_VARS_FILE_BYTES: number;
export declare const MAX_ITEMS_OVERRIDDEN = 20;
export declare const VAR_NAME: RegExp;
export type VarValue = string | number | boolean | null;
export type VarMap = Record<string, VarValue>;
export interface VarFlags {
    var?: string[];
    varsFile?: string;
}
export declare function checkVarName(name: string, at: string): string;
/** Same limits as the server: <=5000 characters, and NUL cannot be stored by PostgreSQL. */
export declare function checkVarValue(value: string, at: string): string;
export declare function parseVarFlags(raw: string[], flag?: string): VarMap;
/** File: a flat JSON object `{name: scalar}`, <=1 MB, depth <=32, no exponent numbers; a non-regular file is refused. */
export declare function loadVarsFile(file: string, flag?: string): VarMap;
/** `--var` and `--vars-file` are alternatives; neither given = no variables. */
export declare function resolveVariables(o: VarFlags): VarMap | undefined;
export interface ItemOverride {
    templateId: number;
    variables: VarMap;
}
/** `--item <templateId>:<name>=<value>` (repeatable) -> one override per template, in first-seen order. */
export declare function parseItemOverrides(raw: string[]): ItemOverride[];
//# sourceMappingURL=varsInput.d.ts.map