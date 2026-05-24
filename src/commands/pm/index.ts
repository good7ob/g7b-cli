import { Command } from 'commander';
import { registerProjectCommands } from './project';
import { registerTaskCommands } from './task';
import { registerWorkflowCommands } from './workflow';
import { registerReportCommands } from './report';
import { registerTagCommands } from './tag';

export function registerPmCommands(program: Command) {
  const pmCommand = program
    .command('pm')
    .description('Project management — projects, tasks, workflows, reports, tags');

  registerProjectCommands(pmCommand);
  registerTaskCommands(pmCommand);
  registerWorkflowCommands(pmCommand);
  registerReportCommands(pmCommand);
  registerTagCommands(pmCommand);

  return pmCommand;
}
