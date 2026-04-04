import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { ApiClient } from '../client';
import { ImportResult } from '../types';

export function registerImportCommand(program: Command): void {
  const importCmd = program
    .command('import')
    .description('Import data from JSON files');

  importCmd
    .command('project')
    .requiredOption('-f, --file <path>', 'Path to JSON file')
    .description('Import projects from JSON file')
    .action(async (options: any) => {
      try {
        const filePath = path.resolve(options.file);

        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const projectList = JSON.parse(fileContent);

        if (!Array.isArray(projectList)) {
          throw new Error('JSON file must contain an array of projects');
        }

        const client = new ApiClient();
        const result = await client.post<ImportResult>(
          '/progress/projects/import',
          projectList
        );

        console.log(JSON.stringify(result, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  importCmd
    .command('resource')
    .requiredOption('-f, --file <path>', 'Path to JSON file')
    .description('Import cloud resources from JSON file')
    .action(async (options: any) => {
      try {
        const filePath = path.resolve(options.file);

        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const resourceList = JSON.parse(fileContent);

        if (!Array.isArray(resourceList)) {
          throw new Error('JSON file must contain an array of resources');
        }

        const client = new ApiClient();
        const result = await client.post<ImportResult>(
          '/cloud/resources/import',
          resourceList
        );

        console.log(JSON.stringify(result, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });
}
