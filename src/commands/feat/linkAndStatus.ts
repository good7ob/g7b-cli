import { Command } from 'commander';
import chalk from 'chalk';
import apiClient from '../../services/ApiClient';
import { extractRecords } from '../../utils/extractRecords';

export function registerLinkAndStatusCommand(featCommand: Command) {
  featCommand
    .command('link')
    .description('绑定 PR 交付物链接至指定阶段任务并推进状态')
    .requiredOption('--task-id <id>', '对应子任务 ID')
    .requiredOption('--pr-url <url>', 'GitHub Pull Request URL')
    .option('--stage <stage>', '阶段标识: prd | wireframe | design | test', 'design')
    .action(async (options) => {
      try {
        const taskId = parseInt(options.taskId, 10);
        const task = await apiClient.get(`/progress/tasks/${taskId}`);
        if (!task) {
          console.error(chalk.red(`✗ 任务 #${taskId} 不存在`));
          process.exit(1);
        }

        const currentDesc = task.description || '';
        const prUrl = options.prUrl.trim();
        const updatedDesc = currentDesc.includes('PR:')
          ? currentDesc.replace(/PR:\s*https:\/\/[^\s]+/g, `PR: ${prUrl}`)
          : `${currentDesc}\n\nPR: ${prUrl}`.trim();

        await apiClient.put(`/progress/tasks/${taskId}`, {
          description: updatedDesc,
          status: 'in_progress',
        });

        console.log(chalk.green(`\n✓ 成功绑定交付成果至任务 #${taskId}`));
        console.log(`  阶段:       ${options.stage}`);
        console.log(`  PR 链接:    ${chalk.cyan(prUrl)}`);
        console.log(`  任务状态:   in_progress\n`);
      } catch (error: any) {
        console.error(chalk.red(`✗ 绑定交付物失败: ${error?.message || error}`));
        process.exit(1);
      }
    });

  featCommand
    .command('status [parentTaskId]')
    .description('查看特性生命周期与四阶段 PR 交付状态看板')
    .option('--json', '以 JSON 格式输出状态')
    .action(async (parentTaskId, options) => {
      try {
        if (!parentTaskId) {
          console.log(chalk.yellow('提示: 请指定 Parent Task ID，如 `g7b feat status 1822`'));
          return;
        }

        const parentTask = await apiClient.get(`/progress/tasks/${parentTaskId}`);
        if (!parentTask) {
          console.error(chalk.red(`✗ 任务 #${parentTaskId} 不存在`));
          process.exit(1);
        }

        const res = await apiClient.get(`/progress/projects/${parentTask.projectId}/tasks`, {
          parentTaskId,
        });
        const subtasks = extractRecords(res);

        if (options.json) {
          console.log(JSON.stringify({ parentTask, subtasks }, null, 2));
          return;
        }

        console.log(`\n${chalk.bold('📊 特性生命周期治理看板')} — [#${parentTask.id}] ${parentTask.name}`);
        console.log('─'.repeat(85));
        console.log(
          '阶段/子任务'.padEnd(35) +
          '状态'.padEnd(14) +
          '工时'.padEnd(10) +
          '交付物 PR 链接'
        );
        console.log('─'.repeat(85));

        subtasks.forEach((t: any) => {
          const prMatch = (t.description || '').match(/https:\/\/github\.com\/[^\s]+/);
          const prStr = prMatch ? chalk.cyan(prMatch[0]) : chalk.gray('[未绑定 PR]');
          const hoursStr = `${t.actualHours || t.estimatedHours || '-'}h`;
          console.log(
            String(t.name || '').substring(0, 32).padEnd(35) +
            String(t.status || '').padEnd(14) +
            hoursStr.padEnd(10) +
            prStr
          );
        });
        console.log('─'.repeat(85));
      } catch (error: any) {
        console.error(chalk.red(`✗ 查看状态失败: ${error?.message || error}`));
        process.exit(1);
      }
    });
}
