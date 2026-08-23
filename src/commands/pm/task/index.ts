import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { extractRecords } from '../../../utils/extractRecords';
import { planMove } from './movePlan';

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
        // fix: #4 https://github.com/good7ob/g7b-cli/issues/4
        const records = extractRecords(result);

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
    .option('--project-id <id>', 'Move the task to another project (no pre-flight checks — prefer `pm task move`)')
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
        if (options.projectId) body.projectId = parseInt(options.projectId);

        await apiClient.put(`/progress/tasks/${id}`, body);
        console.log(`✓ 任务已更新: ${id}`);
      } catch (error) {
        console.error('✗ 更新任务失败:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  taskCommand
    .command('move <ids...>')
    .description('Move one or more tasks to another project (comma- or space-separated IDs)')
    .requiredOption('--to-project <id>', 'Target project ID')
    .option('--with-subtasks', 'Move each task’s sub-tasks along with it')
    .option('--force', 'Proceed despite validation errors')
    .option('--dry-run', 'Show the plan without writing anything')
    .option('--json', 'Output the plan and result as JSON')
    .action(async (ids: string[], options) => {
      try {
        const taskIds = Array.from(
          new Set(
            ids
              .flatMap((v) => String(v).split(','))
              .map((v) => v.trim())
              .filter(Boolean)
              .map((v) => parseInt(v, 10))
          )
        );
        if (taskIds.some((v) => Number.isNaN(v))) {
          throw new Error('任务 ID 必须是数字');
        }

        const targetId = parseInt(options.toProject, 10);
        const target = await apiClient.get(`/progress/projects/${targetId}`);
        if (!target?.id) {
          throw new Error(`目标项目 ${targetId} 不存在`);
        }

        const fetched = new Map<number, any>();
        const fetchTask = async (id: number) => {
          if (!fetched.has(id)) fetched.set(id, await apiClient.get(`/progress/tasks/${id}`));
          return fetched.get(id);
        };

        let tasks = await Promise.all(taskIds.map(fetchTask));
        const missing = taskIds.filter((id, i) => !tasks[i]?.id);
        if (missing.length) {
          throw new Error(`任务不存在: ${missing.join(', ')}`);
        }

        // GET /progress/tasks/{id} does not populate subTasks, so children have
        // to be looked up through the project task list.
        const attachSubTasks = async (task: any) => {
          const result = await apiClient.get(`/progress/projects/${task.projectId}/tasks`, {
            parentTaskId: task.id,
          });
          // fix: #4 https://github.com/good7ob/g7b-cli/issues/4
          const children = extractRecords(result);
          children.forEach((c: any) => fetched.set(c.id, c));
          return { ...task, subTasks: children.map((c: any) => ({ id: c.id })) };
        };

        tasks = await Promise.all(tasks.map(attachSubTasks));

        if (options.withSubtasks) {
          // Descend until no new descendant shows up, so deep trees move whole.
          const collected = new Map<number, any>(tasks.map((t: any) => [t.id, t]));
          let frontier = tasks;
          while (frontier.length) {
            const next: any[] = [];
            for (const parent of frontier) {
              for (const ref of parent.subTasks || []) {
                if (collected.has(ref.id)) continue;
                const child = await attachSubTasks(await fetchTask(ref.id));
                collected.set(child.id, child);
                next.push(child);
              }
            }
            frontier = next;
          }
          tasks = Array.from(collected.values());
        }

        // Resolve the project of any parent that is not part of this batch, so
        // planMove can tell "parent already lives in the target" from "parent
        // would be left behind".
        const movingIds = new Set(tasks.map((t: any) => t.id));
        const parentProjectIds: Record<number, number> = {};
        for (const parentId of new Set(
          tasks.map((t: any) => t.parentTaskId).filter((p: any) => p && !movingIds.has(p))
        )) {
          const parent = await fetchTask(parentId as number);
          if (parent?.projectId != null) parentProjectIds[parentId as number] = parent.projectId;
        }

        const plan = planMove(tasks, target, {
          force: options.force,
          parentProjectIds,
        });

        if (options.json) {
          console.log(JSON.stringify({ target: { id: target.id, name: target.name }, ...plan }, null, 2));
        } else {
          console.log(`\n移动计划 → 项目 ${target.id} ${target.name || ''}`);
          console.log('─'.repeat(70));
          plan.moves.forEach((m) => console.log(`  移动  ${m.taskId}  ${m.name}  (原项目 ${m.fromProjectId})`));
          plan.issues.forEach((i) =>
            console.log(`  ${i.level === 'error' ? '✗ 错误' : '! 警告'}  ${i.message}`)
          );
          if (!plan.moves.length && !plan.issues.length) console.log('  没有需要移动的任务');
          console.log('─'.repeat(70));
        }

        if (plan.blocked) {
          console.error('✗ 存在阻断性问题，未做任何写入。修正后重试，或加 --force 强制执行。');
          process.exit(1);
        }

        if (options.dryRun) {
          if (!options.json) console.log('（--dry-run，未写入）');
          return;
        }

        for (const m of plan.moves) {
          await apiClient.put(`/progress/tasks/${m.taskId}`, { projectId: target.id });
        }

        // The backend returns the pre-save entity on some paths, so verify by
        // reading each task back instead of trusting the write response.
        const verified: any[] = [];
        for (const m of plan.moves) {
          const after = await apiClient.get(`/progress/tasks/${m.taskId}`);
          verified.push({ taskId: m.taskId, projectId: after?.projectId, ok: after?.projectId === target.id });
        }

        if (options.json) {
          console.log(JSON.stringify({ verified }, null, 2));
        } else {
          verified.forEach((v) =>
            console.log(v.ok ? `✓ 任务 ${v.taskId} 已移动到项目 ${target.id}` : `✗ 任务 ${v.taskId} 移动未生效（当前项目 ${v.projectId}）`)
          );
        }
        if (verified.some((v) => !v.ok)) process.exit(1);
      } catch (error) {
        console.error('✗ 移动任务失败:', error instanceof Error ? error.message : String(error));
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
