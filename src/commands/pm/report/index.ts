import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';

export function registerReportCommands(pmCommand: Command) {
  const reportCommand = pmCommand
    .command('report')
    .description('Progress reports — generate, view, publish, archive');

  reportCommand
    .command('list <project-id>')
    .description('List progress reports for a project')
    .option('--json', 'Output as JSON')
    .action(async (projectId, options) => {
      try {
        const reports = await apiClient.get(`/progress/reports/project/${projectId}`);
        if (options.json) {
          console.log(JSON.stringify(reports, null, 2));
          return;
        }
        const list = Array.isArray(reports) ? reports : reports?.records || [];
        if (!list.length) {
          console.log('No reports found.');
          return;
        }
        console.log(`\n进度报告列表 — 项目 ${projectId}`);
        console.log('─'.repeat(80));
        console.log('ID'.padEnd(8) + '标题'.padEnd(30) + '状态'.padEnd(12) + '创建时间');
        console.log('─'.repeat(80));
        list.forEach((r: any) => {
          console.log(
            String(r.id).padEnd(8) +
            (r.title || '').substring(0, 28).padEnd(30) +
            (r.status || '-').padEnd(12) +
            (r.createdAt || '-')
          );
        });
        console.log('─'.repeat(80));
      } catch (error) {
        console.error('✗ 获取报告列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  reportCommand
    .command('get <id>')
    .description('Get report details')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const report = await apiClient.get(`/progress/reports/${id}`);
        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
          return;
        }
        console.log('\n进度报告');
        console.log('─'.repeat(60));
        console.log(`ID:     ${report.id}`);
        console.log(`标题:   ${report.title || '-'}`);
        console.log(`状态:   ${report.status || '-'}`);
        console.log(`项目:   ${report.projectId}`);
        console.log(`创建:   ${report.createdAt || '-'}`);
        console.log('─'.repeat(60));
        if (report.content) {
          console.log('\n内容:');
          console.log(report.content);
        }
        console.log('─'.repeat(60));
      } catch (error) {
        console.error('✗ 获取报告详情失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  reportCommand
    .command('generate <project-id>')
    .description('Generate an AI progress report for a project')
    .action(async (projectId) => {
      try {
        console.log(`ℹ 正在生成项目 ${projectId} 的 AI 进度报告...`);
        const report = await apiClient.post('/progress/reports/generate', { projectId: parseInt(projectId) });
        console.log(`✓ 报告已生成: [${report?.id || ''}] ${report?.title || ''}`);
      } catch (error) {
        console.error('✗ 生成报告失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  reportCommand
    .command('update <id>')
    .description('Update a report title or content')
    .option('--title <title>', 'New report title')
    .option('--content <content>', 'New report content')
    .action(async (id, options) => {
      try {
        const body: any = {};
        if (options.title) body.title = options.title;
        if (options.content) body.content = options.content;
        await apiClient.put(`/progress/reports/${id}`, body);
        console.log(`✓ 报告已更新: ${id}`);
      } catch (error) {
        console.error('✗ 更新报告失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  reportCommand
    .command('publish <id>')
    .description('Publish a report')
    .action(async (id) => {
      try {
        await apiClient.post(`/progress/reports/${id}/publish`);
        console.log(`✓ 报告已发布: ${id}`);
      } catch (error) {
        console.error('✗ 发布报告失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  reportCommand
    .command('archive <id>')
    .description('Archive a report')
    .action(async (id) => {
      try {
        await apiClient.post(`/progress/reports/${id}/archive`);
        console.log(`✓ 报告已归档: ${id}`);
      } catch (error) {
        console.error('✗ 归档报告失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  reportCommand
    .command('delete <id>')
    .description('Delete a report (soft delete)')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(async (id, options) => {
      try {
        if (!options.force) {
          console.log(`⚠ 即将删除报告 ${id}，使用 -f/--force 确认删除`);
          process.exit(0);
        }
        await apiClient.delete(`/progress/reports/${id}`);
        console.log(`✓ 报告已删除: ${id}`);
      } catch (error) {
        console.error('✗ 删除报告失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return reportCommand;
}
