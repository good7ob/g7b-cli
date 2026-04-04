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
        };

        const data = await client.post<Task>('/progress/tasks', payload);
        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });
}
