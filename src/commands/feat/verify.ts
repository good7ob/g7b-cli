import { Command } from 'commander';
import chalk from 'chalk';
import apiClient from '../../services/ApiClient';
import { extractRecords } from '../../utils/extractRecords';

export function registerVerifyCommand(featCommand: Command) {
  featCommand
    .command('verify <parentTaskId>')
    .description('代码开发前置门禁检查：验证 PRD、Wireframe、详细设计 PR 与 E2E 用例是否均已就绪')
    .option('--json', '以 JSON 格式输出门禁判定结果')
    .action(async (parentTaskId, options) => {
      try {
        const parentTask = await apiClient.get(`/progress/tasks/${parentTaskId}`);
        if (!parentTask) {
          console.error(chalk.red(`✗ 父任务 #${parentTaskId} 不存在`));
          process.exit(1);
        }

        const res = await apiClient.get(`/progress/projects/${parentTask.projectId}/tasks`, {
          parentTaskId,
        });
        const subtasks = extractRecords(res);

        const prdTask = subtasks.find((t: any) => t.name?.includes('PRD') || t.name?.toLowerCase().includes('prd'));
        const wfTask = subtasks.find((t: any) => t.name?.includes('Wireframe') || t.name?.includes('画面'));
        const dsnTask = subtasks.find((t: any) => t.name?.includes('详细设计') || (!t.name?.includes('PRD') && t.name?.includes('架构设计')));
        const testTask = subtasks.find((t: any) => t.name?.includes('测试') || t.name?.toLowerCase().includes('e2e'));

        const checkPr = (t?: any, repoKeyword?: string) => {
          if (!t) return false;
          const desc = t.description || '';
          if (repoKeyword) {
            return desc.includes(`github.com/`) && desc.includes(repoKeyword) && desc.includes('/pull/');
          }
          return desc.includes('github.com/') && desc.includes('/pull/');
        };

        const checks = [
          {
            stage: '1. PRD 需求门禁',
            repo: 'good7ob/prd',
            taskId: prdTask?.id,
            passed: checkPr(prdTask, 'prd'),
            hint: 'PRD PR 尚未就绪，请先完成需求分析与业务规则定义并绑定 PR',
          },
          {
            stage: '2. Wireframe 原型门禁',
            repo: 'good7ob/wireframe',
            taskId: wfTask?.id,
            passed: checkPr(wfTask, 'wireframe'),
            hint: 'UI/画面原型 PR 尚未就绪，请先提交交互原型并绑定 PR',
          },
          {
            stage: '3. 详细设计门禁',
            repo: 'good7ob/detailed-design-document',
            taskId: dsnTask?.id,
            passed: checkPr(dsnTask, 'detailed-design-document'),
            hint: '详细设计 PR 尚未就绪，请先完成架构时序与 API 契约并绑定 PR',
          },
          {
            stage: '4. 测试用例/E2E 门禁',
            repo: 'front-web/e2e',
            taskId: testTask?.id,
            passed: checkPr(testTask) || (testTask?.description?.includes('.feature') ?? false),
            hint: '测试用例与 E2E 场景尚未就绪，请提交测试特性文件并绑定',
          },
        ];

        const allPassed = checks.every((c) => c.passed);

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                parentTaskId: parentTask.id,
                featureName: parentTask.name,
                gatePassed: allPassed,
                checks,
              },
              null,
              2
            )
          );
          if (!allPassed) process.exit(1);
          return;
        }

        console.log(`\n${chalk.bold('🛡️ 特性开工前置门禁检查 (Pre-code Verification Gate)')} — #${parentTask.id} ${parentTask.name}`);
        console.log('─'.repeat(80));
        console.log(
          '阶段'.padEnd(24) +
          '子任务ID'.padEnd(12) +
          '状态'.padEnd(14) +
          '目标仓库'
        );
        console.log('─'.repeat(80));

        checks.forEach((c) => {
          const statusStr = c.passed ? chalk.green('✓ PASSED') : chalk.red('⛔ BLOCKED');
          console.log(
            c.stage.padEnd(22) +
            String(c.taskId || '-').padEnd(12) +
            statusStr.padEnd(20) +
            chalk.gray(c.repo)
          );
        });
        console.log('─'.repeat(80));

        if (allPassed) {
          console.log(chalk.green('\n🎉 GATE PASSED: 设计与用例产出物均已就绪，允许进入代码实现阶段！\n'));
          process.exit(0);
        } else {
          console.log(chalk.red('\n⛔ GATE BLOCKED: 前置门禁未满足，阻断进入代码开发阶段：'));
          checks.filter((c) => !c.passed).forEach((c) => {
            console.log(chalk.yellow(`  • ${c.stage}: ${c.hint}`));
          });
          console.log(chalk.gray('\n提示: 请使用 `g7b feat link --task-id <id> --pr-url <url>` 绑定对应成果物后重试。\n'));
          process.exit(1);
        }
      } catch (error: any) {
        console.error(chalk.red(`✗ 门禁检查失败: ${error?.message || error}`));
        process.exit(1);
      }
    });
}
