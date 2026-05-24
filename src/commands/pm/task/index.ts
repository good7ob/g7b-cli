import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';

export function registerTaskCommands(pmCommand: Command) {
  const taskCommand = pmCommand
    .command('task')
    .description('Task management — create, update, list, batch update');

  taskCommand
    .command('list <project-id>')
    .description('List tasks in a project')
    .option('--status <status>', 'Filter by status (not_started|in_progress|completed|blocked|cancelled)')
    .option('--priority <priority>', 'Filter by priority (high|medium|low)')
    .option('--tags <tags>', 'Filter by tag names (comma-separated)')
    .option('--parent-task-id <id>', 'List sub-tasks of a parent task')
    .option('--sort <field>', 'Sort field', 'createdAt')
    .option('--order <direction>', 'Sort direction (asc|desc)', 'desc')
    .option('--json', 'Output as JSON')
    .option('--csv', 'Output as CSV')
    .action(async (projectId, options) => {
      try {
        const params: any = { sort: options.sort, order: options.order };
        if (options.status) params.status = options.status;
        if (options.priority) params.priority = options.priority;
        if (options.tags) params.tags = options.tags;
        if (options.parentTaskId) params.parentTaskId = options.parentTaskId;

        const result = await apiClient.get(`/progress/projects/${projectId}/tasks`, params);
        const records = Array.isArray(result) ? result : result?.records || [];

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (options.csv) {
          console.log('ID,Name,Status,Priority,Owner,Deadline');
          records.forEach((t: any) => {
            console.log(`${t.id},${t.name},${t.status},${t.priority || ''},${t.ownerName || ''},${t.deadline || ''}`);
          });
          return;
        }

        if (!records.length) {
          console.log('No tasks found.');
          return;
        }

        console.log(`\n任务列表 — 项目 ${projectId}`);
        console.log('─'.repeat(95));
        console.log(
          'ID'.padEnd(8) +
          '任务名称'.padEnd(30) +
          '状态'.padEnd(14) +
          '优先级'.padEnd(10) +
          '负责人'.padEnd(16) +
          '截止日期'
        );
        console.log('─'.repeat(95));
        records.forEach((t: any) => {
          console.log(
            String(t.id).padEnd(8) +
            (t.name || '').substring(0, 28).padEnd(30) +
            (t.status || '').padEnd(14) +
            (t.priority || '-').padEnd(10) +
            (t.ownerName || '-').padEnd(16) +
            (t.deadline || '-')
          );
        });
        console.log('─'.repeat(95));
        console.log(`共 ${records.length} 条任务`);
      } catch (error) {
        console.error('✗ 获取任务列表失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  taskCommand
    .command('get <id>')
    .description('Get task details')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
      try {
        const task = await apiClient.get(`/progress/tasks/${id}`);
        if (options.json) {
          console.log(JSON.stringify(task, null, 2));
          return;
        }
        console.log('\n任务详情');
        console.log('─'.repeat(50));
        console.log(`ID:         ${task.id}`);
        console.log(`名称:       ${task.name}`);
        console.log(`状态:       ${task.status}`);
        console.log(`优先级:     ${task.priority || '-'}`);
        console.log(`描述:       ${task.description || '-'}`);
        console.log(`负责人:     ${task.ownerName || task.ownerId || '-'}`);
        console.log(`截止日期:   ${task.deadline || '-'}`);
        console.log(`父任务ID:   ${task.parentTaskId || '-'}`);
        console.log(`项目ID:     ${task.projectId}`);
        console.log(`执行者类型: ${task.executorType || '-'}`);
        console.log(`阻塞原因:   ${task.blockedReason || '-'}`);
        console.log(`创建时间:   ${task.createdAt || '-'}`);
        if (task.tags?.length) {
          console.log(`标签:       ${task.tags.map((t: any) => t.name || t).join(', ')}`);
        }
        if (task.subTasks?.length) {
          console.log(`子任务数:   ${task.subTasks.length}`);
        }
        console.log('─'.repeat(50));
      } catch (error) {
        console.error('✗ 获取任务详情失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  taskCommand
    .command('create')
    .description('Create a new task')
    .requiredOption('--project-id <id>', 'Project ID')
    .requiredOption('--name <name>', 'Task name')
    .option('--description <desc>', 'Task description')
    .option('--priority <priority>', 'Priority (high|medium|low)', 'medium')
    .option('--status <status>', 'Initial status', 'not_started')
    .option('--deadline <date>', 'Deadline (YYYY-MM-DD)')
    .option('--owner-id <id>', 'Owner user ID')
    .option('--parent-task-id <id>', 'Parent task ID (for sub-tasks)')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const body: any = {
          projectId: parseInt(options.projectId),
          name: options.name,
          priority: options.priority,
          status: options.status,
        };
        if (options.description) body.description = options.description;
        if (options.deadline) body.deadline = options.deadline;
        if (options.ownerId) body.ownerId = parseInt(options.ownerId);
        if (options.parentTaskId) body.parentTaskId = parseInt(options.parentTaskId);

        const task = await apiClient.post('/progress/tasks', body);
        if (options.json) {
          console.log(JSON.stringify(task, null, 2));
          return;
        }
        console.log(`✓ 任务已创建: [${task?.id || ''}] ${options.name}`);
      } catch (error) {
        console.error('✗ 创建任务失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  taskCommand
    .command('update <id>')
    .description('Update a task')
    .option('--name <name>', 'Task name')
    .option('--description <desc>', 'Task description')
    .option('--priority <priority>', 'Priority (high|medium|low)')
    .option('--status <status>', 'Status (not_started|in_progress|completed|blocked|cancelled)')
    .option('--deadline <date>', 'Deadline (YYYY-MM-DD)')
    .option('--owner-id <id>', 'Owner user ID')
    .option('--parent-task-id <id>', 'Parent task ID')
    .action(async (id, options) => {
      try {
        const body: any = {};
        if (options.name) body.name = options.name;
        if (options.description) body.description = options.description;
        if (options.priority) body.priority = options.priority;
        if (options.status) body.status = options.status;
        if (options.deadline) body.deadline = options.deadline;
        if (options.ownerId) body.ownerId = parseInt(options.ownerId);
        if (options.parentTaskId) body.parentTaskId = parseInt(options.parentTaskId);

        await apiClient.put(`/progress/tasks/${id}`, body);
        console.log(`✓ 任务已更新: ${id}`);
      } catch (error) {
        console.error('✗ 更新任务失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  taskCommand
    .command('delete <id>')
    .description('Delete a task')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(async (id, options) => {
      try {
        if (!options.force) {
          console.log(`⚠ 即将删除任务 ${id}，使用 -f/--force 确认删除`);
          process.exit(0);
        }
        await apiClient.delete(`/progress/tasks/${id}`);
        console.log(`✓ 任务已删除: ${id}`);
      } catch (error) {
        console.error('✗ 删除任务失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  taskCommand
    .command('batch-update')
    .description('Batch update multiple tasks')
    .requiredOption('--ids <ids>', 'Comma-separated task IDs')
    .option('--status <status>', 'New status for all tasks')
    .option('--priority <priority>', 'New priority for all tasks')
    .option('--owner-id <id>', 'New owner for all tasks')
    .action(async (options) => {
      try {
        const ids = options.ids.split(',').map((id: string) => parseInt(id.trim()));
        const updates: any = { ids };
        if (options.status) updates.status = options.status;
        if (options.priority) updates.priority = options.priority;
        if (options.ownerId) updates.ownerId = parseInt(options.ownerId);

        await apiClient.put('/progress/tasks/batch', updates);
        console.log(`✓ 已批量更新 ${ids.length} 个任务`);
      } catch (error) {
        console.error('✗ 批量更新失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return taskCommand;
}
