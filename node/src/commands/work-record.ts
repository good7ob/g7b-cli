import { Command } from 'commander';
import { ApiClient } from '../client';
import { WorkRecord, WorkRecordStats } from '../types';

export function registerWorkRecordCommand(program: Command): void {
  const workRecordCmd = program
    .command('work-record')
    .alias('wr')
    .description('Manage AI work records');

  // List work records
  workRecordCmd
    .command('list')
    .option('-p, --project <projectId>', 'Filter by project ID')
    .option('-a, --agent <agent>', 'Filter by AI agent name')
    .option('-t, --task-type <type>', 'Filter by task type')
    .option('-s, --status <status>', 'Filter by status (pending, success, failed)')
    .option('-k, --keyword <keyword>', 'Search by keyword')
    .option('--page <number>', 'Page number', '1')
    .option('--size <number>', 'Page size', '20')
    .description('List AI work records')
    .action(async (options: any) => {
      try {
        const client = new ApiClient();
        const page = parseInt(options.page, 10);
        const size = parseInt(options.size, 10);

        const queryParams: any = {
          pageNo: page,
          pageSize: size,
        };

        if (options.project) queryParams.projectId = parseInt(options.project, 10);
        if (options.agent) queryParams.aiAgent = options.agent;
        if (options.taskType) queryParams.taskType = options.taskType;
        if (options.status) queryParams.status = options.status;
        if (options.keyword) queryParams.keyword = options.keyword;

        const data = await client.post('/forge/ai-work-record/list', queryParams);

        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  // Get work record details
  workRecordCmd
    .command('get <id>')
    .description('Get AI work record details')
    .action(async (id: string) => {
      try {
        const client = new ApiClient();
        const data = await client.get<WorkRecord>(`/forge/ai-work-record/${id}`);
        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  // Create work record
  workRecordCmd
    .command('create')
    .requiredOption('-s, --summary <summary>', 'Task summary (1-500 characters)')
    .requiredOption('-a, --agent <agent>', 'AI agent name')
    .requiredOption('-o, --output-path <path>', 'Output/document path (1-1000 characters)')
    .option('-t, --task-type <type>', 'Task type (feature, bugfix, refactor, docs, analysis)')
    .option('-st, --status <status>', 'Status (pending, in_progress, success, failed)')
    .option('-r, --result <result>', 'Result (completed, partial, failed)')
    .option('-d, --description <description>', 'Detailed description')
    .option('-e, --error-message <message>', 'Error message if failed')
    .option('-tk, --token-usage <number>', 'Token usage count')
    .option('-dur, --duration-ms <number>', 'Execution duration in milliseconds')
    .option('-m, --model-version <version>', 'Model version used')
    .option('-p, --project <projectId>', 'Associated project ID')
    .option('--task <taskId>', 'Associated task ID')
    .option('--user <userId>', 'User ID')
    .option('--tags <tags>', 'Tags (comma-separated)')
    .option('--remark <remark>', 'Additional remarks')
    .option('-c, --completed-at <timestamp>', 'Completion timestamp (ISO 8601)')
    .description('Create a new AI work record')
    .action(async (options: any) => {
      try {
        // Validate required fields
        if (!options.summary || options.summary.length < 1 || options.summary.length > 500) {
          throw new Error('Summary must be 1-500 characters');
        }
        if (!options.agent || options.agent.length === 0) {
          throw new Error('AI agent name is required');
        }
        if (!options.outputPath || options.outputPath.length < 1 || options.outputPath.length > 1000) {
          throw new Error('Output path must be 1-1000 characters');
        }

        const client = new ApiClient();

        const payload: WorkRecord = {
          summary: options.summary,
          aiAgent: options.agent,
          outputPath: options.outputPath,
          completedAt: options.completedAt || new Date().toISOString(),
        };

        // Optional fields
        if (options.taskType) payload.taskType = options.taskType;
        if (options.status) payload.status = options.status;
        if (options.result) payload.result = options.result;
        if (options.description) payload.description = options.description;
        if (options.errorMessage) payload.errorMessage = options.errorMessage;
        if (options.tokenUsage) payload.tokenUsage = parseInt(options.tokenUsage, 10);
        if (options.durationMs) payload.durationMs = parseInt(options.durationMs, 10);
        if (options.modelVersion) payload.modelVersion = options.modelVersion;
        if (options.project) payload.projectId = parseInt(options.project, 10);
        if (options.task) payload.taskId = parseInt(options.task, 10);
        if (options.user) payload.userId = parseInt(options.user, 10);
        if (options.tags) payload.tags = options.tags;
        if (options.remark) payload.remark = options.remark;

        const data = await client.post<WorkRecord>('/forge/ai-work-record', payload);
        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  // Update work record
  workRecordCmd
    .command('update <id>')
    .option('-s, --summary <summary>', 'Task summary')
    .option('-a, --agent <agent>', 'AI agent name')
    .option('-o, --output-path <path>', 'Output/document path')
    .option('-t, --task-type <type>', 'Task type')
    .option('-st, --status <status>', 'Status')
    .option('-r, --result <result>', 'Result')
    .option('-d, --description <description>', 'Description')
    .option('-e, --error-message <message>', 'Error message')
    .option('-tk, --token-usage <number>', 'Token usage count')
    .option('-dur, --duration-ms <number>', 'Execution duration')
    .option('-m, --model-version <version>', 'Model version')
    .option('--tags <tags>', 'Tags')
    .option('--remark <remark>', 'Remarks')
    .description('Update an AI work record')
    .action(async (id: string, options: any) => {
      try {
        const client = new ApiClient();

        const payload: any = { id: parseInt(id, 10) };

        // Only include fields that were provided
        if (options.summary) payload.summary = options.summary;
        if (options.agent) payload.aiAgent = options.agent;
        if (options.outputPath) payload.outputPath = options.outputPath;
        if (options.taskType) payload.taskType = options.taskType;
        if (options.status) payload.status = options.status;
        if (options.result) payload.result = options.result;
        if (options.description) payload.description = options.description;
        if (options.errorMessage) payload.errorMessage = options.errorMessage;
        if (options.tokenUsage) payload.tokenUsage = parseInt(options.tokenUsage, 10);
        if (options.durationMs) payload.durationMs = parseInt(options.durationMs, 10);
        if (options.modelVersion) payload.modelVersion = options.modelVersion;
        if (options.tags) payload.tags = options.tags;
        if (options.remark) payload.remark = options.remark;

        const data = await client.put<WorkRecord>(`/forge/ai-work-record/${id}`, payload);
        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  // Delete work record
  workRecordCmd
    .command('delete <id>')
    .description('Delete an AI work record (soft delete)')
    .action(async (id: string) => {
      try {
        const client = new ApiClient();
        const result = await client.delete(`/forge/ai-work-record/${id}`);
        console.log(JSON.stringify({ success: true, message: 'Work record deleted', result }, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  // Batch delete work records
  workRecordCmd
    .command('batch-delete <ids...>')
    .description('Delete multiple AI work records (soft delete)')
    .action(async (ids: string[]) => {
      try {
        const client = new ApiClient();
        const idNumbers = ids.map(id => parseInt(id, 10));
        const result = await client.post('/forge/ai-work-record/batch-delete', { ids: idNumbers });
        console.log(
          JSON.stringify(
            {
              success: true,
              message: `${idNumbers.length} work records deleted`,
              result,
            },
            null,
            2
          )
        );
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  // Get statistics
  workRecordCmd
    .command('stats')
    .option('-p, --project <projectId>', 'Filter by project ID')
    .option('-u, --user <userId>', 'Filter by user ID')
    .option('-r, --range <range>', 'Time range (today, week, month, lastMonth)')
    .description('Get AI work record statistics')
    .action(async (options: any) => {
      try {
        const client = new ApiClient();

        const queryParams: any = {};
        if (options.project) queryParams.projectId = parseInt(options.project, 10);
        if (options.user) queryParams.userId = parseInt(options.user, 10);
        if (options.range) queryParams.timeRange = options.range;

        const data = await client.get<WorkRecordStats>('/forge/ai-work-record/stats', {
          params: queryParams,
        });

        console.log(JSON.stringify(data, null, 2));
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });

  // Export work records
  workRecordCmd
    .command('export')
    .option('-p, --project <projectId>', 'Filter by project ID')
    .option('-a, --agent <agent>', 'Filter by AI agent')
    .option('-f, --format <format>', 'Export format (json, csv)', 'json')
    .option('-o, --output <file>', 'Output file path')
    .description('Export AI work records')
    .action(async (options: any) => {
      try {
        const client = new ApiClient();
        const fs = await import('fs');

        const queryParams: any = {
          pageNo: 1,
          pageSize: 1000,
        };

        if (options.project) queryParams.projectId = parseInt(options.project, 10);
        if (options.agent) queryParams.aiAgent = options.agent;

        const data = await client.post('/forge/ai-work-record/list', queryParams);

        let output: string;
        if (options.format === 'csv') {
          // Simple CSV export
          const records = data.records || [];
          const headers = [
            'ID',
            'Summary',
            'AI Agent',
            'Task Type',
            'Status',
            'Result',
            'Token Usage',
            'Duration (ms)',
            'Completed At',
          ];
          const rows = records.map((r: any) =>
            [
              r.id,
              `"${r.summary.replace(/"/g, '""')}"`,
              r.aiAgent,
              r.taskType || '',
              r.status || '',
              r.result || '',
              r.tokenUsage || '',
              r.durationMs || '',
              r.completedAt || '',
            ].join(',')
          );
          output = [headers.join(','), ...rows].join('\n');
        } else {
          output = JSON.stringify(data, null, 2);
        }

        if (options.output) {
          fs.writeFileSync(options.output, output);
          console.log(JSON.stringify({ success: true, file: options.output }));
        } else {
          console.log(output);
        }
      } catch (err: any) {
        console.error(JSON.stringify({ error: err.message }));
        process.exit(1);
      }
    });
}
