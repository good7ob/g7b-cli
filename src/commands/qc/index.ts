import { Command } from 'commander';
import { registerBugCommands } from './bug';
import { registerReportCommands } from './report';
import { registerPipelineCommands } from './pipeline';
import { registerTestCaseCommands } from './testcase';
import { addTestRunCommands, registerTestRunCommands } from './testRun';

export function registerQcCommands(program: Command) {
  const qcCommand = program
    .command('qc')
    .description('质量控制 — Bug 追踪、测试用例库、质量报表');

  registerBugCommands(qcCommand);
  registerTestCaseCommands(qcCommand);
  registerReportCommands(qcCommand);
  registerPipelineCommands(qcCommand);
  // 一次导入报告与截图（N-9）：`qc run upload|latest`，顶层 `test-run upload|latest`（prd-0082 FP-17 的命令名）是同一实现
  addTestRunCommands(qcCommand.commands.find((c) => c.name() === 'run')!);
  registerTestRunCommands(program);

  return qcCommand;
}
