#!/usr/bin/env node

/**
 * good7ob CLI - Main Entry Point
 * Official command-line interface for the good7ob platform
 */

import { Command } from 'commander';
import { registerInfraCommands } from './commands/infra';
import { registerPmCommands } from './commands/pm';
import { registerOrgCommands } from './commands/org';
import { registerQcCommands } from './commands/qc';
import { registerConfigCommands } from './commands/config';
import { registerPrdCommands } from './commands/prd';
import { registerReqCommands } from './commands/req';
import { registerLogCommands } from './commands/log';

const program = new Command();

program
  .name('good7ob')
  .description('good7ob - Project management and cloud resource management CLI')
  .version('0.1.0');

// Register command groups
registerInfraCommands(program);
registerPmCommands(program);
registerOrgCommands(program);
registerQcCommands(program);
registerConfigCommands(program);
registerPrdCommands(program);
registerReqCommands(program);
registerLogCommands(program);

// Parse command line arguments
program.parse(process.argv);

// Show help if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
