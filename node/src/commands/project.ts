import { Command } from 'commander';
import { ApiClient } from '../client';
import { Project } from '../types';

export function registerProjectCommand(program: Command): void {
  const projectCmd = program
    .command('project')
    .description('Manage projects');

  projectCmd
    .command('list')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-s, --size <number>', 'Page size', '20')
    .description('List all projects')
    .action(async (options: any) => {
      try {
        const client = new ApiClient();
        const page = parseInt(options.page, 10);
        const size = parseInt(options.size, 10);

        const data = await client.get('/progress/projects', {
          params: { page, pageSize: size },
        });

        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  projectCmd
    .command('get <id>')
    .description('Get project details')
    .action(async (id: string) => {
      try {
        const client = new ApiClient();
        const data = await client.get<Project>(`/progress/projects/${id}`);
        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  projectCmd
    .command('create')
    .option('-n, --name <name>', 'Project name', '')
    .option('-d, --description <description>', 'Project description', '')
    .description('Create a new project')
    .action(async (options: any) => {
      try {
        if (!options.name) {
          throw new Error('Project name is required (use --name)');
        }

        const client = new ApiClient();
        const payload: Project = {
          projectName: options.name,
          description: options.description,
        };

        const data = await client.post<Project>('/progress/projects', payload);
        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });
}
