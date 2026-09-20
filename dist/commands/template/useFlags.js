"use strict";
/** Option groups shared by `use`, `package use` and `upgrade --preview`. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withOutFlags = exports.withVarFlags = exports.withTargetFlags = void 0;
const cliHelpers_1 = require("../../utils/cliHelpers");
/** --org / --product (required) and the per-type target options. */
function withTargetFlags(cmd) {
    return cmd
        .requiredOption('--org <orgId>', 'Target organization (you must be an active member)')
        .requiredOption('--product <productId>', 'Target product (must belong to that organization)')
        .option('--module <moduleId>', 'TASK: module the tasks go into (required); PRD: module to link (optional)')
        .option('--suite <suiteId>', 'TEST: case suite (optional)')
        .option('--start <yyyy-MM-dd>', 'RELEASE: planned start date (optional)')
        .option('--end <yyyy-MM-dd>', 'RELEASE: planned end date (optional, not before --start)')
        .option('--with-deps', 'Install missing / outdated installable dependencies in the same transaction');
}
exports.withTargetFlags = withTargetFlags;
function withVarFlags(cmd) {
    return cmd
        .option('--var <name=value>', 'Variable value, repeatable (max 50 variables, 5000 chars each)', cliHelpers_1.collect)
        .option('--vars-file <file.json>', 'Variables as a JSON object {"name": value} (max 1 MB, depth 32); alternative to --var');
}
exports.withVarFlags = withVarFlags;
function withOutFlags(cmd, what) {
    return cmd
        .option('--out <file>', `Write ${what} to this file (never overwrites an existing file unless --force; regular files only)`)
        .option('--force', 'Allow --out to overwrite an existing regular file');
}
exports.withOutFlags = withOutFlags;
//# sourceMappingURL=useFlags.js.map