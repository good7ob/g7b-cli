/** Option groups shared by `use`, `package use` and `upgrade --preview`. */
import { Command } from 'commander';
/** --org / --product (required) and the per-type target options. */
export declare function withTargetFlags(cmd: Command): Command;
export declare function withVarFlags(cmd: Command): Command;
export declare function withOutFlags(cmd: Command, what: string): Command;
//# sourceMappingURL=useFlags.d.ts.map