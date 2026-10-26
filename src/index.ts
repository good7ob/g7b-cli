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
import { registerKbCommands } from './commands/kb';
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
import { registerSchemaCommands } from './commands/schema';
import { registerCloudArchCommands } from './commands/cloudArch';
import { registerBlogCommands } from './commands/blog';
import { registerWorktreeCommands } from './commands/worktree';
import { registerAgentCommands } from './commands/agent';
import { registerDevInfoCommands } from './commands/devInfo';
import { registerFileCommands } from './commands/file';
import { registerExportCommands } from './commands/export';
import { registerHeartbeatCommands } from './commands/heartbeat';
import { registerQuestionCommands } from './commands/question';
import { registerSyncCommands } from './commands/sync';
import { registerGithubCommands } from './commands/github';
import { registerUiCommands } from './commands/ui';
import { registerProgressCommands } from './commands/progress';
import { registerEstimateCommands } from './commands/estimate';
import { registerEvalCommands } from './commands/eval';
import { registerHabitCommands } from './commands/habit';
import { registerArtifactCommands } from './commands/artifact';
import { registerDeliverableCommands } from './commands/deliverable';

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
registerKbCommands(program);
registerReqCommands(program);
registerLogCommands(program);
registerCaseCommands(program);
registerIdeaCommands(program);
registerWorkspaceCommands(program);
registerReleaseCommands(program);
registerApprovalCommands(program);
registerTraceCommands(program);
registerQuestionCommands(program);
registerTemplateCommands(program);
registerWhoamiCommands(program);
registerSyncCommands(program);
registerGithubCommands(program);
registerSchemaCommands(program);
registerCloudArchCommands(program);
registerBlogCommands(program);
registerWorktreeCommands(program);
registerAgentCommands(program);
registerDevInfoCommands(program);
registerFileCommands(program);
registerExportCommands(program);
registerHeartbeatCommands(program);
registerUiCommands(program);
registerProgressCommands(program);
registerEstimateCommands(program);
registerEvalCommands(program);
registerHabitCommands(program);
registerArtifactCommands(program);
registerDeliverableCommands(program);

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
