"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAgentReportCommands = void 0;
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
const extractRecords_1 = require("../../../utils/extractRecords");
const API_PREFIX = '/forge/agent-work-reports';
/**
 * Aggregated daily/weekly reports over `log` records (g7b #918).
 * Backend: com.remostudio.forge.report.controller.AgentWorkReportController.
 */
function registerAgentReportCommands(logCommand) {
    const reportCommand = logCommand
        .command('report')
        .description('AI agent work daily/weekly reports — generate, list, view, publish');
    reportCommand
        .command('generate')
        .description('Generate or regenerate a daily/weekly report (idempotent upsert)')
        .requiredOption('--scope <type>', 'Scope: personal or project')
        .requiredOption('--type <type>', 'Report type: daily or weekly')
        .option('--user-id <id>', 'User ID (required when --scope personal)')
        .option('--project-id <id>', 'Project ID (required when --scope project)')
        .option('--period-start <date>', 'Period start date (YYYY-MM-DD), default: auto-computed')
        .option('--period-end <date>', 'Period end date (YYYY-MM-DD), default: auto-computed')
        .option('--json', 'Output result as JSON')
        .action(async (options) => {
        try {
            const body = {
                scopeType: options.scope,
                reportType: options.type,
            };
            if (options.userId)
                body.userId = parseInt(options.userId);
            if (options.projectId)
                body.projectId = parseInt(options.projectId);
            if (options.periodStart)
                body.periodStart = options.periodStart;
            if (options.periodEnd)
                body.periodEnd = options.periodEnd;
            const report = await ApiClient_1.default.post(`${API_PREFIX}/generate`, body);
            if (options.json) {
                console.log(JSON.stringify(report, null, 2));
                return;
            }
            console.log(`✓ 报告已生成: [${report?.id || ''}] ${report?.title || ''}`);
        }
        catch (error) {
            console.error('✗ 生成报告失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    reportCommand
        .command('list')
        .description('List agent work reports')
        .option('--scope <type>', 'Filter by scope: personal or project')
        .option('--user-id <id>', 'Filter by user ID')
        .option('--project-id <id>', 'Filter by project ID')
        .option('--type <type>', 'Filter by report type: daily or weekly')
        .option('-p, --page <num>', 'Page number', '1')
        .option('-l, --limit <num>', 'Items per page', '20')
        .option('--json', 'Output as JSON')
        .action(async (options) => {
        try {
            const params = {
                page: parseInt(options.page) || 1,
                pageSize: parseInt(options.limit) || 20,
            };
            if (options.scope)
                params.scopeType = options.scope;
            if (options.userId)
                params.userId = parseInt(options.userId);
            if (options.projectId)
                params.projectId = parseInt(options.projectId);
            if (options.type)
                params.reportType = options.type;
            const result = await ApiClient_1.default.get(API_PREFIX, params);
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            // fix: #4 https://github.com/good7ob/g7b-cli/issues/4
            const records = (0, extractRecords_1.extractRecords)(result);
            if (!records.length) {
                console.log('No reports found.');
                return;
            }
            console.log('\nAI 智能体工作报告');
            console.log('─'.repeat(100));
            console.log('ID'.padEnd(8) +
                '维度'.padEnd(10) +
                '类型'.padEnd(8) +
                '周期'.padEnd(24) +
                '状态'.padEnd(10) +
                '标题');
            console.log('─'.repeat(100));
            records.forEach((r) => {
                console.log(String(r.id).padEnd(8) +
                    (r.scopeType || '-').padEnd(10) +
                    (r.reportType || '-').padEnd(8) +
                    `${r.periodStart || '-'}~${r.periodEnd || '-'}`.padEnd(24) +
                    (r.status || '-').padEnd(10) +
                    (r.title || '').substring(0, 40));
            });
            console.log('─'.repeat(100));
            const total = (0, extractRecords_1.extractTotal)(result, records);
            console.log(`共 ${total} 条，第 ${params.page}/${Math.ceil(total / params.pageSize)} 页`);
        }
        catch (error) {
            console.error('✗ 获取报告列表失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    reportCommand
        .command('get <id>')
        .description('Get report details, including LLM narrative content and stats snapshot')
        .option('--json', 'Output as JSON')
        .action(async (id, options) => {
        try {
            const report = await ApiClient_1.default.get(`${API_PREFIX}/${id}`);
            if (options.json) {
                console.log(JSON.stringify(report, null, 2));
                return;
            }
            console.log('\n工作报告详情');
            console.log('─'.repeat(60));
            console.log(`ID:         ${report.id}`);
            console.log(`标题:       ${report.title || '-'}`);
            console.log(`维度:       ${report.scopeType || '-'}`);
            console.log(`用户ID:     ${report.userId ?? '-'}`);
            console.log(`项目ID:     ${report.projectId ?? '-'}`);
            console.log(`类型:       ${report.reportType || '-'}`);
            console.log(`周期:       ${report.periodStart || '-'} ~ ${report.periodEnd || '-'}`);
            console.log(`状态:       ${report.status || '-'}`);
            console.log(`AI生成:     ${report.isAiGenerated ? '是' : '否（模板兜底）'}`);
            console.log(`生成来源:   ${report.generationSource || '-'}`);
            console.log(`已通知:     ${report.notifiedAt || '未通知'}`);
            console.log(`创建时间:   ${report.createdAt || '-'}`);
            console.log('─'.repeat(60));
            if (report.content) {
                console.log('\n正文:\n');
                console.log(report.content);
            }
        }
        catch (error) {
            console.error('✗ 获取报告详情失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    reportCommand
        .command('publish <id>')
        .description('Publish a report (draft -> published)')
        .action(async (id) => {
        try {
            await ApiClient_1.default.put(`${API_PREFIX}/${id}/publish`);
            console.log(`✓ 报告已发布: ${id}`);
        }
        catch (error) {
            console.error('✗ 发布报告失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    reportCommand
        .command('delete <id>')
        .description('Delete a report (soft delete)')
        .option('-f, --force', 'Skip confirmation')
        .action(async (id, options) => {
        try {
            if (!options.force) {
                console.log(`⚠ 即将删除报告 ${id}，使用 -f/--force 确认`);
                process.exit(0);
            }
            await ApiClient_1.default.delete(`${API_PREFIX}/${id}`);
            console.log(`✓ 报告已删除: ${id}`);
        }
        catch (error) {
            console.error('✗ 删除报告失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    return reportCommand;
}
exports.registerAgentReportCommands = registerAgentReportCommands;
//# sourceMappingURL=index.js.map