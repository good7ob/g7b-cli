#!/usr/bin/env node

import { Command } from 'commander';
import { registerConfigCommand } from './commands/config';
import { registerProjectCommand } from './commands/project';
import { registerTaskCommand } from './commands/task';
import { registerImportCommand } from './commands/import';

const program = new Command();

program
  .name('good7ob')
  .description('Official CLI for good7ob platform')
  .version('0.1.0');

// Register all commands
registerConfigCommand(program);
registerProjectCommand(program);
registerTaskCommand(program);
registerImportCommand(program);

program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
