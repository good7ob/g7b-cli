import { Command } from 'commander';
import { ConfigManager } from '../config';

export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage good7ob CLI configuration');

  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, value: string) => {
      const manager = new ConfigManager();
      manager.set(key, value);
      console.log(JSON.stringify({ success: true, key, value }));
    });

  configCmd
    .command('show')
    .description('Show current configuration')
    .action(() => {
      const manager = new ConfigManager();
      manager.show();
    });
}
