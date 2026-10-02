import { Command } from 'commander';
import { registerProjectCommands } from './project';
import { registerTaskCommands } from './task';
import { registerPlanCommands } from './plan';
import { registerWorkflowCommands } from './workflow';
import { registerReportCommands } from './report';
import { registerTagCommands } from './tag';
import { registerHealthCommands } from './health';
import { registerActivityCommands } from './activity';

export function registerPmCommands(program: Command) {
  const pmCommand = program
    .command('pm')
    .description('Project management — projects, tasks, workflows, reports, tags, product health, activity feed');

  registerProjectCommands(pmCommand);
  registerTaskCommands(pmCommand);
  registerPlanCommands(pmCommand);
  registerWorkflowCommands(pmCommand);
  registerReportCommands(pmCommand);
  registerTagCommands(pmCommand);
  registerHealthCommands(pmCommand);
  registerActivityCommands(pmCommand);

  return pmCommand;
}
