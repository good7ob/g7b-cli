/**
 * Infra Module CLI Commands
 *
 * Entry point for all infra-related CLI commands:
 * - infra app: Application portfolio management
 * - infra resource: Cloud resource management
 * - infra cost: Cost analysis and monitoring
 * - infra bill: Bill import and management
 */
import { Command } from 'commander';
import { registerAppCommands } from './app';
import { registerResourceCommands } from './resource';
import { registerCostCommands } from './cost';
import { registerBillCommands } from './bill';
export declare function registerInfraCommands(program: Command): Command;
export { registerAppCommands, registerResourceCommands, registerCostCommands, registerBillCommands };
//# sourceMappingURL=index.d.ts.map