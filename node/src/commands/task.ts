import { Command } from 'commander';
import { ApiClient } from '../client';
import { Task } from '../types';

export function registerTaskCommand(program: Command): void {
  const taskCmd = program
    .command('task')
    .description('Manage tasks');

  taskCmd
    .command('list')
    .requiredOption('-p, --project <projectId>', 'Project ID')
    .option('--page <number>', 'Page number', '1')
    .option('-s, --size <number>', 'Page size', '20')
    .description('List tasks in a project')
    .action(async (options: any) => {
      try {
        const client = new ApiClient();
        const projectId = options.project;
        const page = parseInt(options.page, 10);
        const size = parseInt(options.size, 10);

        const data = await client.get(
          `/progress/projects/${projectId}/tasks`,
          { params: { page, pageSize: size } }
        );

        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  taskCmd
    .command('get <id>')
    .description('Get task details')
    .action(async (id: string) => {
      try {
        const client = new ApiClient();
        const data = await client.get<Task>(`/progress/tasks/${id}`);
        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  taskCmd
    .command('create')
    .requiredOption('-p, --project <projectId>', 'Project ID')
    .option('-t, --title <title>', 'Task title', '')
    .option('-d, --description <description>', 'Task description', '')
    .option('--priority <priority>', 'Priority: high | medium | low', 'medium')
    .option('--status <status>', 'Status: not_started | in_progress | completed | blocked | cancelled', 'not_started')
    .option('--deadline <date>', 'Deadline (YYYY-MM-DD)')
    .option('--owner-id <ownerId>', 'Owner user ID')
    .description('Create a new task')
    .action(async (options: any) => {
      try {
        if (!options.title) {
          throw new Error('Task title is required (use --title)');
        }

        const client = new ApiClient();
        const payload: Task = {
          projectId: parseInt(options.project, 10),
          title: options.title,
          description: options.description,
          priority: options.priority,
          status: options.status,
          ...(options.deadline && { deadline: options.deadline }),
          ...(options.ownerId && { ownerId: parseInt(options.ownerId, 10) }),
        };

        const data = await client.post<Task>('/progress/tasks', payload);
        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  taskCmd
    .command('update <id>')
    .option('-t, --title <title>', 'Task title')
    .option('-d, --description <description>', 'Task description')
    .option('--priority <priority>', 'Priority: high | medium | low')
    .option('--status <status>', 'Status: not_started | in_progress | completed | blocked | cancelled')
    .option('--deadline <date>', 'Deadline (YYYY-MM-DD)')
    .option('--owner-id <ownerId>', 'Owner user ID')
    .description('Update a task')
    .action(async (id: string, options: any) => {
      try {
        const client = new ApiClient();
        const payload: Partial<Task> = {};

        if (options.title) payload.title = options.title;
        if (options.description) payload.description = options.description;
        if (options.priority) payload.priority = options.priority;
        if (options.status) payload.status = options.status;
        if (options.deadline) payload.deadline = options.deadline;
        if (options.ownerId) payload.ownerId = parseInt(options.ownerId, 10);

        if (Object.keys(payload).length === 0) {
          throw new Error('No fields to update. Use --title, --status, --priority, etc.');
        }

        const data = await client.put<Task>(`/progress/tasks/${id}`, payload);
        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });
}
