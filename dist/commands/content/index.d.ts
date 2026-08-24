import { Command } from 'commander';
/**
 * Read-only CLI access to org product copy/text resources
 * (MOD-19-SUB-09, fun-org-copy-0005).
 *
 * Calls the same plain list endpoint used by the web "文案资源" tab —
 * not the CSV/SQL export endpoint — and only differs in how the
 * response is rendered locally (table/json/csv).
 */
export declare function registerContentCommands(program: Command): Command;
export declare function csvField(value: unknown): string;
//# sourceMappingURL=index.d.ts.map