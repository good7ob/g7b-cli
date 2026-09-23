#!/usr/bin/env node

/**
 * good7ob CLI - Main Entry Point
 * Official command-line interface for the good7ob platform
 */

import { Command } from 'commander';
import { registerInfraCommands } from './commands/infra';
import { registerPmCommands } from './commands/pm';
import { registerOrgCommands } from './commands/org';
import { registerContentCommands } from './commands/content';
import { registerQcCommands } from './commands/qc';
import { registerConfigCommands } from './commands/config';
import { registerPrdCommands } from './commands/prd';
import { registerReqCommands } from './commands/req';
import { registerLogCommands } from './commands/log';
import { registerCaseCommands } from './commands/case';
import { registerIdeaCommands } from './commands/idea';
import { registerWorkspaceCommands } from './commands/workspace';
import { registerReleaseCommands } from './commands/release';
import { registerApprovalCommands } from './commands/approval';
import { registerTraceCommands } from './commands/trace';
import { registerTemplateCommands } from './commands/template';
import { registerWhoamiCommands } from './commands/whoami';

const program = new Command();

program
  .name('good7ob')
  .description('good7ob - Project management and cloud resource management CLI')
  .version('0.2.0');

// Register command groups
registerInfraCommands(program);
registerPmCommands(program);
registerOrgCommands(program);
registerContentCommands(program);
registerQcCommands(program);
registerConfigCommands(program);
registerPrdCommands(program);
registerReqCommands(program);
registerLogCommands(program);
registerCaseCommands(program);
registerIdeaCommands(program);
registerWorkspaceCommands(program);
registerReleaseCommands(program);
registerApprovalCommands(program);
registerTraceCommands(program);
registerTemplateCommands(program);
registerWhoamiCommands(program);

// Called after the groups are registered so it only affects the root: without it the root
// swallows a `--version` given after a subcommand (`release create --version 1.2.0` would
// print the CLI version and exit). `good7ob --version` / `-V` still work.
program.enablePositionalOptions();

// Parse command line arguments
program.parse(process.argv);

// Show help if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
