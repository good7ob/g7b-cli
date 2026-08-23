"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLogCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const extractRecords_1 = require("../../utils/extractRecords");
function registerLogCommands(program) {
    const logCommand = program
        .command('log')
        .description('Agent work log management — save, list, view, stats');
    // save (create)
    logCommand
        .command('save')
        .description('Save an agent work log record')
        .requiredOption('--summary <text>', 'Task summary (max 500 chars)')
        .requiredOption('--agent <name>', 'AI agent name (e.g. claude, gpt-4, gemini)')
        .requiredOption('--output <path>', 'Output path or document path (max 1000 chars)')
        .option('--project-id <id>', 'Associated project ID')
        .option('--task-id <id>', 'Associated task ID')
        .option('--task-type <type>', 'Task type (feature|bugfix|refactor|docs|analysis|other)')
        .option('--status <status>', 'Execution status (success|failed|pending)', 'success')
        .option('--result <result>', 'Execution result (completed|partial|failed)', 'completed')
        .option('--input <text>', 'Input summary')
        .option('--error <msg>', 'Error message (if failed)')
        .option('--tokens <num>', 'Token count used')
        .option('--duration <ms>', 'Execution duration in milliseconds')
        .option('--model <version>', 'Model version (e.g. claude-sonnet-4-6)')
        .option('--session-id <id>', 'Session ID')
        .option('--parent-id <id>', 'Parent record ID (for chained calls)')
        .option('--tags <tags>', 'Comma-separated tags')
        .option('--remark <text>', 'Remarks')
        .option('--completed-at <datetime>', 'Completion time (ISO format, default: now)')
        .option('--json', 'Output result as JSON')
        .action(async (options) => {
        try {
            const body = {
                summary: options.summary,
                aiAgent: options.agent,
                outputPath: options.output,
                status: options.status,
                result: options.result,
                completedAt: options.completedAt || new Date().toISOString(),
            };
            if (options.projectId)
                body.projectId = parseInt(options.projectId);
            if (options.taskId)
                body.taskId = parseInt(options.taskId);
            if (options.taskType)
                body.taskType = options.taskType;
            if (options.input)
                body.inputSummary = options.input;
            if (options.error)
                body.errorMessage = options.error;
            if (options.tokens)
                body.tokenUsage = parseInt(options.tokens);
            if (options.duration)
                body.durationMs = parseInt(options.duration);
            if (options.model)
                body.modelVersion = options.model;
            if (options.sessionId)
                body.sessionId = options.sessionId;
            if (options.parentId)
                body.parentId = parseInt(options.parentId);
            if (options.tags)
                body.tags = options.tags;
            if (options.remark)
                body.remark = options.remark;
            const record = await ApiClient_1.default.post('/forge/ai-work-record', body);
            if (options.json) {
                console.log(JSON.stringify(record, null, 2));
                return;
            }
            console.log(`✓ 工作日志已保存: [${record?.id || ''}] ${options.summary.substring(0, 60)}`);
        }
        catch (error) {
            console.error('✗ 保存工作日志失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // list
    logCommand
        .command('list')
        .description('List agent work logs')
        .option('--project-id <id>', 'Filter by project ID')
        .option('--task-id <id>', 'Filter by task ID')
        .option('--agent <name>', 'Filter by agent name')
        .option('--task-type <type>', 'Filter by task type')
        .option('--status <status>', 'Filter by status (success|failed|pending)')
        .option('--result <result>', 'Filter by result (completed|partial|failed)')
        .option('--search <keyword>', 'Search in summary')
        .option('--start-date <date>', 'Start date filter (YYYY-MM-DD)')
        .option('--end-date <date>', 'End date filter (YYYY-MM-DD)')
        .option('-p, --page <num>', 'Page number', '1')
        .option('-l, --limit <num>', 'Items per page', '20')
        .option('--json', 'Output as JSON')
        .option('--csv', 'Output as CSV')
        .action(async (options) => {
        try {
            const body = {
                pageNo: parseInt(options.page) || 1,
                pageSize: parseInt(options.limit) || 20,
            };
            if (options.projectId)
                body.projectId = parseInt(options.projectId);
            if (options.taskId)
                body.taskId = parseInt(options.taskId);
            if (options.agent)
                body.aiAgent = options.agent;
            if (options.taskType)
                body.taskType = options.taskType;
            if (options.status)
                body.status = options.status;
            if (options.result)
                body.result = options.result;
            if (options.search)
                body.keyword = options.search;
            if (options.startDate)
                body.startDate = options.startDate;
            if (options.endDate)
                body.endDate = options.endDate;
            const result = await ApiClient_1.default.post('/forge/ai-work-record/list', body);
            // fix: #4 https://github.com/good7ob/g7b-cli/issues/4
            const records = (0, extractRecords_1.extractRecords)(result);
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            if (options.csv) {
                console.log('ID,Agent,TaskType,Status,Result,Summary,Tokens,Duration(ms),CompletedAt');
                records.forEach((r) => {
                    console.log(`${r.id},${r.aiAgent || ''},${r.taskType || ''},${r.status || ''},${r.result || ''},"${(r.summary || '').replace(/"/g, '""')}",${r.tokenUsage || ''},${r.durationMs || ''},${r.completedAt || ''}`);
                });
                return;
            }
            if (!records.length) {
                console.log('No work logs found.');
                return;
            }
            console.log('\nAgent 工作日志');
            console.log('─'.repeat(100));
            console.log('ID'.padEnd(8) +
                'Agent'.padEnd(14) +
                '类型'.padEnd(12) +
                '状态'.padEnd(10) +
                'Token'.padEnd(10) +
                '耗时(ms)'.padEnd(12) +
                '摘要');
            console.log('─'.repeat(100));
            records.forEach((r) => {
                console.log(String(r.id).padEnd(8) +
                    (r.aiAgent || '-').substring(0, 12).padEnd(14) +
                    (r.taskType || '-').substring(0, 10).padEnd(12) +
                    (r.status || '-').padEnd(10) +
                    String(r.tokenUsage || '-').padEnd(10) +
                    String(r.durationMs || '-').padEnd(12) +
                    (r.summary || '').substring(0, 30));
            });
            console.log('─'.repeat(100));
            if (result?.total) {
                console.log(`共 ${result.total} 条，第 ${body.pageNo}/${Math.ceil(result.total / body.pageSize)} 页`);
            }
        }
        catch (error) {
            console.error('✗ 获取工作日志失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // get
    logCommand
        .command('get <id>')
        .description('Get work log details')
        .option('--json', 'Output as JSON')
        .action(async (id, options) => {
        try {
            const record = await ApiClient_1.default.get(`/forge/ai-work-record/${id}`);
            if (options.json) {
                console.log(JSON.stringify(record, null, 2));
                return;
            }
            console.log('\n工作日志详情');
            console.log('─'.repeat(60));
            console.log(`ID:         ${record.id}`);
            console.log(`Agent:      ${record.aiAgent || '-'}`);
            console.log(`任务类型:   ${record.taskType || '-'}`);
            console.log(`状态:       ${record.status || '-'}`);
            console.log(`结果:       ${record.result || '-'}`);
            console.log(`摘要:       ${record.summary || '-'}`);
            console.log(`输入摘要:   ${record.inputSummary || '-'}`);
            console.log(`输出路径:   ${record.outputPath || '-'}`);
            console.log(`Token 用量: ${record.tokenUsage ?? '-'}`);
            console.log(`耗时:       ${record.durationMs ? `${record.durationMs}ms` : '-'}`);
            console.log(`模型版本:   ${record.modelVersion || '-'}`);
            console.log(`Session ID: ${record.sessionId || '-'}`);
            console.log(`项目 ID:    ${record.projectId || '-'}`);
            console.log(`任务 ID:    ${record.taskId || '-'}`);
            console.log(`标签:       ${record.tags || '-'}`);
            console.log(`备注:       ${record.remark || '-'}`);
            if (record.errorMessage) {
                console.log(`错误信息:   ${record.errorMessage}`);
            }
            console.log(`完成时间:   ${record.completedAt || '-'}`);
            console.log(`创建时间:   ${record.createdAt || '-'}`);
            console.log('─'.repeat(60));
        }
        catch (error) {
            console.error('✗ 获取工作日志失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // update
    logCommand
        .command('update <id>')
        .description('Update a work log record')
        .option('--summary <text>', 'Task summary')
        .option('--status <status>', 'Execution status (success|failed|pending)')
        .option('--result <result>', 'Execution result (completed|partial|failed)')
        .option('--output <path>', 'Output path')
        .option('--error <msg>', 'Error message')
        .option('--tokens <num>', 'Token count used')
        .option('--duration <ms>', 'Execution duration in milliseconds')
        .option('--tags <tags>', 'Comma-separated tags')
        .option('--remark <text>', 'Remarks')
        .option('--task-type <type>', 'Task type (feature|bugfix|refactor|docs|analysis|other)')
        .option('--project-id <id>', 'Link the record to a project')
        .option('--task-id <id>', 'Link the record to a task')
        .option('--json', 'Output result as JSON')
        .action(async (id, options) => {
        try {
            const body = {};
            if (options.summary)
                body.summary = options.summary;
            if (options.status)
                body.status = options.status;
            if (options.result)
                body.result = options.result;
            if (options.output)
                body.outputPath = options.output;
            if (options.error)
                body.errorMessage = options.error;
            if (options.tokens)
                body.tokenUsage = parseInt(options.tokens);
            if (options.duration)
                body.durationMs = parseInt(options.duration);
            if (options.tags)
                body.tags = options.tags;
            if (options.remark)
                body.remark = options.remark;
            if (options.taskType)
                body.taskType = options.taskType;
            if (options.projectId)
                body.projectId = parseInt(options.projectId);
            if (options.taskId)
                body.taskId = parseInt(options.taskId);
            if (Object.keys(body).length === 0) {
                console.error('✗ 未指定任何要更新的字段');
                process.exit(1);
            }
            const updated = await ApiClient_1.default.put(`/forge/ai-work-record/${id}`, body);
            if (options.json) {
                console.log(JSON.stringify(updated, null, 2));
                return;
            }
            console.log(`✓ 工作日志已更新: ${id} (${Object.keys(body).join(', ')})`);
        }
        catch (error) {
            console.error('✗ 更新工作日志失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // delete
    logCommand
        .command('delete <id>')
        .description('Delete a work log record (soft delete)')
        .option('-f, --force', 'Skip confirmation')
        .action(async (id, options) => {
        try {
            if (!options.force) {
                console.log(`⚠ 即将删除工作日志 ${id}，使用 -f/--force 确认`);
                process.exit(0);
            }
            await ApiClient_1.default.delete(`/forge/ai-work-record/${id}`);
            console.log(`✓ 工作日志已删除: ${id}`);
        }
        catch (error) {
            console.error('✗ 删除工作日志失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // batch-delete
    logCommand
        .command('batch-delete')
        .description('Batch delete work log records')
        .requiredOption('--ids <ids>', 'Comma-separated record IDs')
        .option('-f, --force', 'Skip confirmation')
        .action(async (options) => {
        try {
            const ids = options.ids.split(',').map((id) => parseInt(id.trim()));
            if (!options.force) {
                console.log(`⚠ 即将批量删除 ${ids.length} 条工作日志，使用 -f/--force 确认`);
                process.exit(0);
            }
            await ApiClient_1.default.post('/forge/ai-work-record/batch-delete', ids);
            console.log(`✓ 已批量删除 ${ids.length} 条工作日志`);
        }
        catch (error) {
            console.error('✗ 批量删除失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // stats
    logCommand
        .command('stats')
        .description('Get work log statistics')
        .option('--project-id <id>', 'Filter by project ID')
        .option('--user-id <id>', 'Filter by user ID')
        .option('--json', 'Output as JSON')
        .action(async (options) => {
        try {
            const params = {};
            if (options.projectId)
                params.projectId = options.projectId;
            if (options.userId)
                params.userId = options.userId;
            const stats = await ApiClient_1.default.get('/forge/ai-work-record/statistics', params);
            if (options.json) {
                console.log(JSON.stringify(stats, null, 2));
                return;
            }
            console.log('\nAgent 工作日志统计');
            console.log('─'.repeat(40));
            console.log(`总记录数:   ${stats.totalCount ?? '-'}`);
            console.log(`成功数:     ${stats.successCount ?? '-'}`);
            console.log(`失败数:     ${stats.failedCount ?? '-'}`);
            console.log(`总 Token:   ${stats.totalTokenUsage ?? '-'}`);
            console.log(`平均耗时:   ${stats.avgDurationMs ? `${stats.avgDurationMs}ms` : '-'}`);
            if (stats.byAgent) {
                console.log('\n按 Agent 分布:');
                Object.entries(stats.byAgent).forEach(([agent, count]) => {
                    console.log(`  ${agent}: ${count}`);
                });
            }
            if (stats.byTaskType) {
                console.log('\n按任务类型分布:');
                Object.entries(stats.byTaskType).forEach(([type, count]) => {
                    console.log(`  ${type}: ${count}`);
                });
            }
            console.log('─'.repeat(40));
        }
        catch (error) {
            console.error('✗ 获取统计信息失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    return logCommand;
}
exports.registerLogCommands = registerLogCommands;
//# sourceMappingURL=index.js.map