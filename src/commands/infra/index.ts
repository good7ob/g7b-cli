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

export function registerInfraCommands(program: Command) {
  const infraCommand = program
    .command('infra')
    .description('Manage cloud infrastructure, resources, costs, and billing');

  // Register sub-command groups
  registerAppCommands(infraCommand);
  registerResourceCommands(infraCommand);
  registerCostCommands(infraCommand);
  registerBillCommands(infraCommand);

  return infraCommand;
}

export { registerAppCommands, registerResourceCommands, registerCostCommands, registerBillCommands };
