import { Command } from 'commander';
import { registerBugCommands } from './bug';
import { registerReportCommands } from './report';

export function registerQcCommands(program: Command) {
  const qcCommand = program
    .command('qc')
    .description('质量控制 — Bug 追踪、质量报表');

  registerBugCommands(qcCommand);
  registerReportCommands(qcCommand);

  return qcCommand;
}
