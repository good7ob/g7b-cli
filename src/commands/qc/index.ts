import { Command } from 'commander';
import { registerBugCommands } from './bug';
import { registerReportCommands } from './report';
import { registerPipelineCommands } from './pipeline';
import { registerTestCaseCommands } from './testcase';

export function registerQcCommands(program: Command) {
  const qcCommand = program
    .command('qc')
    .description('质量控制 — Bug 追踪、测试用例库、质量报表');

  registerBugCommands(qcCommand);
  registerTestCaseCommands(qcCommand);
  registerReportCommands(qcCommand);
  registerPipelineCommands(qcCommand);

  return qcCommand;
}
