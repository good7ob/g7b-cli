import { Command } from 'commander';
/**
 * Task / project activity feed (prd-0092 FP-6, api-0092): `pm activity` lists, `pm activity post`
 * writes a manual NOTE / REPORT_UPLOADED entry. `activity` is a command with a subcommand, and commander
 * lets an ancestor consume a flag it knows wherever it appears (`post --task 5` is read by `activity`),
 * so both actions read their options through `cmd.optsWithGlobals()` — no defaults on the parent flags.
 */
export declare function registerActivityCommands(pmCommand: Command): void;
//# sourceMappingURL=index.d.ts.map