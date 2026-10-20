import { Command } from 'commander';
import { registerInitCommand } from './init';
import { registerEnvelopeCommand } from './sufficiency';
import { registerVerifyCommand } from './verify';
import { registerLinkAndStatusCommand } from './linkAndStatus';

export function registerFeatCommands(program: Command) {
  const featCommand = program
    .command('feat')
    .description('特性全生命周期规范治理 — 任务信封、初始化、成果绑定、状态看板与门禁');

  registerInitCommand(featCommand);
  registerEnvelopeCommand(featCommand);
  registerVerifyCommand(featCommand);
  registerLinkAndStatusCommand(featCommand);
}
