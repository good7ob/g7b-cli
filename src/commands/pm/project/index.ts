import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';

export function registerProjectCommands(pmCommand: Command) {
  const projectCommand = pmCommand
    .command('project')
    .description('Project management — create, update, list, archive, participants');

  projectCommand
    .command('list')
    .description('List projects')
    .option('--status <status>', 'Filter by status (not_started|in_progress|paused|completed)')
    .option('--search <keyword>', 'Search by keyword')
    .option('--include-archived', 'Include archived projects')
    .option('--sort <field>', 'Sort field', 'createdAt')
    .option('--order <direction>', 'Sort direction (asc|desc)', 'desc')
    .option('-p, --page <num>', 'Page number', '1')
    .option('-l, --limit <num>', 'Items per page', '20')
    .option('--json', 'Output as JSON')
    .option('--csv', 'Output as CSV')
    .action(async (options) => {
      try {
        const params: any = {
          page: parseInt(options.page) || 1,
          pageSize: parseInt(options.limit) || 20,
          sort: options.sort,
          order: options.order,
        };
        if (options.status) params.status = options.status;
        if (options.search) params.keyword = options.search;
        if (options.includeArchived) params.includeArchived = true;

        const result = await apiClient.get('/progress/projects', params);
        const records = result?.records || result || [];

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (options.csv) {
          console.log('ID,Name,Status,Progress,Owner,StartDate,EndDate,Tasks');
          records.forEach((p: any) => {
            console.log(`${p.id},${p.name},${p.status},${p.progress || 0}%,${p.ownerName || ''},${p.startDate || ''},${p.endDate || ''},${p.taskCount || 0}`);
          });
          return;
        }

        if (!records.length) {
          console.log('No projects found.');
          return;
        }

        console.log('\n项目列表');
        console.log('─'.repeat(90));
        console.log('ID'.padEnd(8) + '项目名称'.padEnd(28) + '状态'.padEnd(14) + '进度'.padEnd(8) + '任务数'.padEnd(8) + '截止日期');
        console.log('─'.repeat(90));
        records.forEach((p: any) => {
          console.log(
            String(p.id).padEnd(8) +
            (p.name || '').substring(0, 26).padEnd(28) +
            (p.status || '').padEnd(14) +
            `${p.progress || 0}%`.padEnd(8) +
            String(p.taskCount || 0).padEnd(8) +
            (p.endDate || '-')
          );
        });
        console.log('─'.repeat(90));
        if (result?.total) {
          console.log(`共 ${result.total} 条，第 ${params.page}/${Math.ceil(result.total / params.pageSize)} 页`);
        }
      } catch (error) {
        console.error('✗ 获取项目列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  projectCommand
    .command('get <id>')
    .description('Get project details')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const project = await apiClient.get(`/progress/projects/${id}`);
        if (options.json) {
          console.log(JSON.stringify(project, null, 2));
          return;
        }
        console.log('\n项目详情');
        console.log('─'.repeat(50));
        console.log(`ID:       ${project.id}`);
        console.log(`名称:     ${project.name}`);
        console.log(`状态:     ${project.status}`);
        console.log(`进度:     ${project.progress || 0}%`);
        console.log(`描述:     ${project.description || '-'}`);
        console.log(`负责人:   ${project.ownerName || project.ownerId || '-'}`);
        console.log(`开始日期: ${project.startDate || '-'}`);
        console.log(`结束日期: ${project.endDate || '-'}`);
        console.log(`任务总数: ${project.taskCount || 0}`);
        console.log(`已完成:   ${project.completedTaskCount || 0}`);
        console.log(`剩余天数: ${project.daysRemaining ?? '-'}`);
        console.log(`已归档:   ${project.isArchived ? '是' : '否'}`);
        console.log(`创建时间: ${project.createdAt || '-'}`);
        console.log('─'.repeat(50));
      } catch (error) {
        console.error('✗ 获取项目详情失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  projectCommand
    .command('create')
    .description('Create a new project')
    .requiredOption('--name <name>', 'Project name')
    .option('--description <desc>', 'Project description')
    .option('--start-date <date>', 'Start date (YYYY-MM-DD)')
    .option('--end-date <date>', 'End date (YYYY-MM-DD)')
    .option('--owner-id <id>', 'Owner user ID')
    .option('--status <status>', 'Initial status', 'not_started')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const body: any = { name: options.name, status: options.status };
        if (options.description) body.description = options.description;
        if (options.startDate) body.startDate = options.startDate;
        if (options.endDate) body.endDate = options.endDate;
        if (options.ownerId) body.ownerId = parseInt(options.ownerId);

        const project = await apiClient.post('/progress/projects', body);
        if (options.json) {
          console.log(JSON.stringify(project, null, 2));
          return;
        }
        console.log(`✓ 项目已创建: [${project?.id || ''}] ${options.name}`);
      } catch (error) {
        console.error('✗ 创建项目失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  projectCommand
    .command('update <id>')
    .description('Update a project')
    .option('--name <name>', 'Project name')
    .option('--description <desc>', 'Project description')
    .option('--start-date <date>', 'Start date (YYYY-MM-DD)')
    .option('--end-date <date>', 'End date (YYYY-MM-DD)')
    .option('--owner-id <id>', 'Owner user ID')
    .option('--status <status>', 'Status (not_started|in_progress|paused|completed)')
    .action(async (id, options) => {
      try {
        const body: any = {};
        if (options.name) body.name = options.name;
        if (options.description) body.description = options.description;
        if (options.startDate) body.startDate = options.startDate;
        if (options.endDate) body.endDate = options.endDate;
        if (options.ownerId) body.ownerId = parseInt(options.ownerId);
        if (options.status) body.status = options.status;

        await apiClient.put(`/progress/projects/${id}`, body);
        console.log(`✓ 项目已更新: ${id}`);
      } catch (error) {
        console.error('✗ 更新项目失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  projectCommand
    .command('delete <id>')
    .description('Delete a project (soft delete)')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(async (id, options) => {
      try {
        if (!options.force) {
          console.log(`⚠ 即将删除项目 ${id}，使用 -f/--force 确认删除`);
          process.exit(0);
        }
        await apiClient.delete(`/progress/projects/${id}`);
        console.log(`✓ 项目已删除: ${id}`);
      } catch (error) {
        console.error('✗ 删除项目失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  projectCommand
    .command('archive <id>')
    .description('Archive or unarchive a project')
    .option('--unarchive', 'Unarchive the project instead')
    .action(async (id, options) => {
      try {
        const archived = !options.unarchive;
        await apiClient.post(`/progress/projects/${id}/archive?archived=${archived}`);
        console.log(`✓ 项目已${archived ? '归档' : '取消归档'}: ${id}`);
      } catch (error) {
        console.error('✗ 操作失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  projectCommand
    .command('recalculate <id>')
    .description('Recalculate project progress from task completion')
    .action(async (id) => {
      try {
        const result = await apiClient.post(`/progress/projects/${id}/recalculate`);
        console.log(`✓ 项目进度已重新计算: ${id}`);
        if (result?.progress !== undefined) {
          console.log(`  当前进度: ${result.progress}%`);
        }
      } catch (error) {
        console.error('✗ 重新计算失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  projectCommand
    .command('gantt <id>')
    .description('Get Gantt chart data for a project')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const data = await apiClient.get(`/progress/projects/${id}/gantt`);
        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        const tasks = data?.tasks || data || [];
        console.log(`\nGantt 数据 — 项目 ${id}`);
        console.log('─'.repeat(80));
        console.log('任务ID'.padEnd(10) + '任务名称'.padEnd(30) + '开始'.padEnd(14) + '截止'.padEnd(14) + '状态');
        console.log('─'.repeat(80));
        tasks.forEach((t: any) => {
          console.log(
            String(t.id).padEnd(10) +
            (t.name || '').substring(0, 28).padEnd(30) +
            (t.startDate || '-').padEnd(14) +
            (t.deadline || '-').padEnd(14) +
            (t.status || '')
          );
        });
        console.log('─'.repeat(80));
      } catch (error) {
        console.error('✗ 获取 Gantt 数据失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  projectCommand
    .command('participants <id>')
    .description('List project participants')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const participants = await apiClient.get(`/progress/projects/${id}/participants`);
        if (options.json) {
          console.log(JSON.stringify(participants, null, 2));
          return;
        }
        const list = Array.isArray(participants) ? participants : [];
        console.log(`\n项目参与者 — 项目 ${id}`);
        console.log('─'.repeat(60));
        console.log('ID'.padEnd(8) + '显示名'.padEnd(20) + '角色'.padEnd(15) + '用户ID');
        console.log('─'.repeat(60));
        list.forEach((p: any) => {
          console.log(
            String(p.id).padEnd(8) +
            (p.displayName || '').padEnd(20) +
            (p.role || '').padEnd(15) +
            (p.userId || '-')
          );
        });
        console.log('─'.repeat(60));
      } catch (error) {
        console.error('✗ 获取参与者失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  projectCommand
    .command('add-participant <project-id>')
    .description('Add a participant to a project')
    .requiredOption('--user-id <id>', 'User ID to add')
    .option('--display-name <name>', 'Display name')
    .option('--role <role>', 'Role in project')
    .action(async (projectId, options) => {
      try {
        const body: any = { userId: parseInt(options.userId) };
        if (options.displayName) body.displayName = options.displayName;
        if (options.role) body.role = options.role;
        await apiClient.post(`/progress/projects/${projectId}/participants`, body);
        console.log(`✓ 参与者已添加至项目 ${projectId}`);
      } catch (error) {
        console.error('✗ 添加参与者失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  projectCommand
    .command('remove-participant <participant-id>')
    .description('Remove a participant from a project')
    .option('-f, --force', 'Skip confirmation')
    .action(async (participantId, options) => {
      try {
        if (!options.force) {
          console.log(`⚠ 即将移除参与者 ${participantId}，使用 -f/--force 确认`);
          process.exit(0);
        }
        await apiClient.delete(`/progress/participants/${participantId}`);
        console.log(`✓ 参与者已移除: ${participantId}`);
      } catch (error) {
        console.error('✗ 移除参与者失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return projectCommand;
}
