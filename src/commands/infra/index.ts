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
import apiClient from '../../services/ApiClient';
import configService from '../../services/ConfigService';
import { resolveOrgId } from '../../utils/resolveOrgId';

export function registerInfraCommands(program: Command) {
  const infraCommand = program
    .command('infra')
    .description('Manage cloud infrastructure, resources, costs, and billing')
    // fix: #564 https://github.com/good7ob/backend/issues/564
    // infra data is isolated per organization: resolve it once for every subcommand
    .option('--org-id <id>', '组织 ID（云成本数据按组织隔离；也可用 GOOD7OB_ORG_ID 或 config set org-id）')
    .hook('preAction', (thisCommand, actionCommand) => {
      try {
        const option = actionCommand.opts().orgId ?? thisCommand.opts().orgId;
        apiClient.setInfraOrgId(resolveOrgId(option, configService.get('orgId')));
      } catch (error) {
        console.error('✗', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Register sub-command groups
  registerAppCommands(infraCommand);
  registerResourceCommands(infraCommand);
  registerCostCommands(infraCommand);
  registerBillCommands(infraCommand);

  return infraCommand;
}

export { registerAppCommands, registerResourceCommands, registerCostCommands, registerBillCommands };
