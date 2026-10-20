import { Command } from 'commander';
import chalk from 'chalk';
import apiClient from '../../services/ApiClient';
import {
  generateEnvelopeTemplate,
  parseTaskEnvelope,
  evaluateTaskSufficiency,
} from '../../templates/taskEnvelope';

export function registerEnvelopeCommand(featCommand: Command) {
  featCommand
    .command('envelope [taskId]')
    .description('任务上下文信封管理 — 查看解析信封或输出空白模板')
    .option('--template', '输出标准任务信封 Markdown 模板')
    .option('--json', '以 JSON 格式输出解析后的信封元数据')
    .action(async (taskId, options) => {
      try {
        if (options.template || !taskId) {
          const tpl = generateEnvelopeTemplate({
            name: '特性名称',
            slug: 'feature-slug',
            level: 'L3',
            intent: '解决的核心问题说明',
          });
          if (options.json) {
            console.log(JSON.stringify({ template: tpl }, null, 2));
          } else {
            console.log(tpl);
          }
          return;
        }

        const task = await apiClient.get(`/progress/tasks/${taskId}`);
        if (!task) {
          console.error(chalk.red(`✗ 任务 #${taskId} 不存在`));
          process.exit(1);
        }

        const parsed = parseTaskEnvelope(task.description || '');

        if (options.json) {
          console.log(JSON.stringify({ taskId: task.id, name: task.name, ...parsed }, null, 2));
          return;
        }

        console.log(`\n${chalk.bold.blue('📦 任务上下文信封 (Task Context Envelope)')} — #${task.id} ${task.name}`);
        console.log('─'.repeat(70));
        console.log(`信封格式:     ${parsed.hasEnvelope ? chalk.green('✓ 标准 Frontmatter') : chalk.yellow('⚠ 未包含标准头部')}`);
        console.log(`交付等级:     ${parsed.meta.deliveryLevel ? chalk.cyan(parsed.meta.deliveryLevel) : chalk.gray('-')}`);
        console.log(`目标落点:     ${parsed.meta.targetRepo || chalk.gray('-')}`);
        console.log(`特性短链:     ${parsed.meta.slug || chalk.gray('-')}`);
        console.log(`执行策略:     ${parsed.meta.executorStrategy || chalk.gray('AGENT')}`);
        console.log(`签发智能体:   ${parsed.meta.upstreamAgent || chalk.gray('-')}`);
        console.log(`验收条件:     ${parsed.acceptanceCriteria.length} 条 AC 场景`);
        console.log('─'.repeat(70));

        if (parsed.acceptanceCriteria.length > 0) {
          console.log(chalk.bold('\n验收条件摘录:'));
          parsed.acceptanceCriteria.forEach((ac, idx) => {
            console.log(chalk.gray(`[AC-${idx + 1}]`) + '\n' + ac);
          });
        }
      } catch (error: any) {
        console.error(chalk.red(`✗ 读取任务信封失败: ${error?.message || error}`));
        process.exit(1);
      }
    });

  featCommand
    .command('verify-sufficiency <taskId>')
    .description('充分性判定机：判定任务信封要素是否充足，支持 Hermes 自动化开工')
    .option('--json', '以 JSON 格式输出判定结果')
    .action(async (taskId, options) => {
      try {
        const task = await apiClient.get(`/progress/tasks/${taskId}`);
        if (!task) {
          console.error(chalk.red(`✗ 任务 #${taskId} 不存在`));
          process.exit(1);
        }

        const parsed = parseTaskEnvelope(task.description || '');
        const evaluation = evaluateTaskSufficiency(parsed, task.id);

        if (options.json) {
          console.log(JSON.stringify(evaluation, null, 2));
          if (!evaluation.sufficient) process.exit(1);
          return;
        }

        console.log(`\n${chalk.bold('🔍 任务充分性判定报告 (Task Sufficiency Report)')} — #${task.id} ${task.name}`);
        console.log('─'.repeat(75));

        evaluation.checks.forEach((chk) => {
          const icon = chk.passed ? chalk.green('✓ PASS') : chalk.red('✗ FAIL');
          const req = chk.required ? chalk.red('[REQUIRED]') : chalk.gray('[OPTIONAL]');
          console.log(`${icon.padEnd(10)} ${req.padEnd(12)} ${chk.name.padEnd(30)} ${chalk.gray(chk.detail || '')}`);
        });

        console.log('─'.repeat(75));
        console.log(`综合评分: ${evaluation.score >= 80 ? chalk.green(evaluation.score + '/100') : chalk.red(evaluation.score + '/100')}`);

        if (evaluation.sufficient) {
          console.log(chalk.green(`\n✓ 判定结果: PASS — ${evaluation.summary}\n`));
          process.exit(0);
        } else {
          console.log(chalk.red(`\n✗ 判定结果: BLOCKED — ${evaluation.summary}\n`));
          process.exit(1);
        }
      } catch (error: any) {
        console.error(chalk.red(`✗ 充分性判定执行失败: ${error?.message || error}`));
        process.exit(1);
      }
    });
}
