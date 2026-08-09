"use strict";
/**
 * Application Portfolio Management Commands
 *
 * Subcommands:
 * - infra app create: Create a new application
 * - infra app update: Update application information
 * - infra app delete: Delete an application
 * - infra app get: Get application details
 * - infra app list: List all applications
 * - infra app import: Batch import applications from CSV
 * - infra app export: Export application inventory
 * - infra app tag: Manage application tags
 * - infra app bind-resource: Associate resources to application
 * - infra app unbind-resource: Remove resource association
 * - infra app auto-bind: Configure automatic resource association rules
 * - infra app health-check: Perform application inventory health check
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAppCommands = void 0;
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
/** Page size used when walking the full application list. */
const FETCH_ALL_PAGE_SIZE = 200;
/** Safety stop so a bad total can never spin this forever. */
const FETCH_ALL_MAX_PAGES = 500;
/**
 * Fetch every application matching the filters, following pagination to the end.
 *
 * fix: #1 https://github.com/remo-studio/solution-juren/issues/1
 * Callers used to post an empty body and take whatever the first default-sized page
 * returned — 20 records — while believing they had the full inventory.
 */
async function fetchAllApplications(filters = {}) {
    const collected = [];
    let pageNo = 1;
    let total = 0;
    while (pageNo <= FETCH_ALL_MAX_PAGES) {
        const page = await ApiClient_1.default.post('/api/infra/applications/list', {
            ...filters,
            pageNo,
            pageSize: FETCH_ALL_PAGE_SIZE,
        });
        const records = page?.records || [];
        total = typeof page?.total === 'number' ? page.total : total;
        collected.push(...records);
        if (records.length < FETCH_ALL_PAGE_SIZE || collected.length >= total) {
            break;
        }
        pageNo++;
    }
    if (total > collected.length) {
        // Never let a cap pass silently — the caller asked for everything.
        console.warn(`⚠ 仅获取到 ${collected.length}/${total} 个应用（已达 ${FETCH_ALL_MAX_PAGES} 页上限），结果不完整`);
    }
    return collected;
}
function registerAppCommands(infraCommand) {
    const appCommand = infraCommand
        .command('app')
        .description('Application portfolio management');
    // 1. create
    appCommand
        .command('create')
        .description('Create a new application')
        .option('-n, --name <name>', 'Application name (required)')
        .option('-e, --environment <env>', 'Environment: production/staging/dev/test (default: production)')
        .option('-o, --owner-id <id>', 'Owner ID (required)')
        .option('--co-owner-id <id>', 'Co-owner ID (optional)')
        .option('-d, --description <desc>', 'Application description (optional)')
        .option('-t, --tags <tags>', 'Tags, comma-separated (optional)')
        .option('--tech-stack <stack>', 'Technology stack (optional)')
        .option('--arch-type <type>', 'Architecture type: monolith/microservice/serverless/container (optional)')
        .option('--deps <deps>', 'Dependencies (optional)')
        .option('--launch-date <date>', 'Launch date YYYY-MM-DD (optional)')
        .option('--eol-date <date>', 'Expected EOL date YYYY-MM-DD (optional)')
        .option('-s, --status <status>', 'Status: active/inactive/archived (default: active)')
        .option('--created-by <id>', 'Creator user ID (required, typically current user ID)')
        .action(async (options) => {
        try {
            if (!options.name || !options.ownerId || !options.createdBy) {
                console.error('Error: --name, --owner-id, and --created-by are required');
                process.exit(1);
            }
            const payload = {
                name: options.name,
                environment: options.environment || 'production',
                ownerId: parseInt(options.ownerId),
                createdBy: parseInt(options.createdBy),
                coOwnerId: options.coOwnerId ? parseInt(options.coOwnerId) : null,
                description: options.description,
                tags: options.tags,
                techStack: options.techStack,
                archType: options.archType,
                dependencies: options.deps,
                launchDate: options.launchDate,
                expectedEolDate: options.eolDate,
                status: options.status || 'active',
            };
            const result = await ApiClient_1.default.post('/api/infra/applications', payload);
            console.log('✓ Application created successfully');
            console.log(`  Application ID: ${result}`);
        }
        catch (error) {
            console.error('✗ Failed to create application:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // 2. update
    appCommand
        .command('update <app-id>')
        .description('Update application information')
        .option('-n, --name <name>', 'Application name')
        .option('-e, --environment <env>', 'Environment')
        .option('-o, --owner-id <id>', 'Owner ID')
        .option('--co-owner-id <id>', 'Co-owner ID')
        .option('-d, --description <desc>', 'Application description')
        .option('-t, --tags <tags>', 'Tags, comma-separated')
        .option('--tech-stack <stack>', 'Technology stack')
        .option('--arch-type <type>', 'Architecture type')
        .option('--deps <deps>', 'Dependencies')
        .option('-s, --status <status>', 'Status')
        .action(async (appId, options) => {
        try {
            const payload = {};
            if (options.name)
                payload.name = options.name;
            if (options.environment)
                payload.environment = options.environment;
            if (options.ownerId)
                payload.ownerId = parseInt(options.ownerId);
            if (options.coOwnerId)
                payload.coOwnerId = parseInt(options.coOwnerId);
            if (options.description)
                payload.description = options.description;
            if (options.tags)
                payload.tags = options.tags.split(',').map((t) => t.trim());
            if (options.techStack)
                payload.techStack = options.techStack;
            if (options.archType)
                payload.archType = options.archType;
            if (options.deps)
                payload.dependencies = options.deps;
            if (options.status)
                payload.status = options.status;
            await ApiClient_1.default.put(`/api/infra/applications/${appId}`, payload);
            console.log('✓ Application updated successfully');
        }
        catch (error) {
            console.error('✗ Failed to update application:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // 3. delete
    appCommand
        .command('delete <app-id>')
        .description('Delete an application')
        .option('--force, -f', 'Skip confirmation (force delete)')
        .option('--soft-delete', 'Soft delete (default)')
        .option('--hard-delete', 'Hard delete')
        .action(async (appId, options) => {
        try {
            if (!options.force) {
                console.log(`⚠ You are about to delete application ${appId}`);
                console.log('Use --force to skip this confirmation');
                process.exit(0);
            }
            await ApiClient_1.default.delete(`/api/infra/applications/${appId}`);
            console.log('✓ Application deleted successfully');
        }
        catch (error) {
            console.error('✗ Failed to delete application:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // 4. get
    appCommand
        .command('get <app-id>')
        .description('Get application details')
        .option('--show-resources', 'Show associated resources')
        .option('--json', 'JSON format output')
        .option('--yaml', 'YAML format output')
        .action(async (appId, options) => {
        try {
            const app = await ApiClient_1.default.get(`/api/infra/applications/${appId}`);
            if (options.json) {
                console.log(JSON.stringify(app, null, 2));
            }
            else {
                console.log('Application Details:');
                console.log('─'.repeat(50));
                console.log(`ID: ${app.id}`);
                console.log(`Name: ${app.name}`);
                console.log(`Environment: ${app.environment}`);
                console.log(`Status: ${app.status}`);
                console.log(`Owner ID: ${app.ownerId}`);
                if (app.description)
                    console.log(`Description: ${app.description}`);
                if (app.tags)
                    console.log(`Tags: ${app.tags}`);
                if (app.techStack)
                    console.log(`Tech Stack: ${app.techStack}`);
            }
            if (options.showResources) {
                const resources = await ApiClient_1.default.get(`/api/infra/applications/${appId}/resources`);
                console.log(`\nAssociated Resources (${resources.length}):`);
                resources.forEach((r) => {
                    console.log(`  - ${r.resourceName} (${r.resourceType})`);
                });
            }
        }
        catch (error) {
            console.error('✗ Failed to get application:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // 5. list
    appCommand
        .command('list')
        .description('List all applications')
        .option('-e, --environment <env>', 'Filter by environment')
        .option('-o, --owner-id <id>', 'Filter by owner')
        .option('-t, --tags <tags>', 'Filter by tags, comma-separated')
        .option('-s, --status <status>', 'Filter by status')
        .option('--search <keyword>', 'Search by application name')
        .option('--sort <field>', 'Sort field: name/created-at/cost (default: created-at)')
        .option('--order <asc|desc>', 'Sort order (default: desc)')
        .option('--page <num>', 'Page number (default: 1)')
        .option('--limit <num>', 'Items per page (default: 20)')
        .option('--json', 'JSON format output')
        .option('--csv', 'CSV format output')
        .action(async (options) => {
        try {
            const params = {
                pageNo: parseInt(options.page) || 1,
                pageSize: parseInt(options.limit) || 20,
            };
            if (options.environment)
                params.environment = options.environment;
            if (options.ownerId)
                params.ownerId = options.ownerId;
            if (options.tags)
                params.tags = options.tags;
            if (options.status)
                params.status = options.status;
            if (options.search)
                params.search = options.search;
            if (options.sort)
                params.sort = options.sort;
            if (options.order)
                params.order = options.order;
            // fix: #1 https://github.com/remo-studio/solution-juren/issues/1
            // the filters were built and then dropped — an empty body was posted instead
            const result = await ApiClient_1.default.post('/api/infra/applications/list', params);
            if (options.json) {
                console.log(JSON.stringify(result, null, 2));
            }
            else if (options.csv) {
                console.log('ID,Name,Environment,Status,Owner,Created');
                result.records.forEach((app) => {
                    console.log(`${app.id},${app.name},${app.environment},${app.status},${app.ownerId},${app.createdAt}`);
                });
            }
            else {
                console.log(`Applications (${result.total}):`);
                console.log('─'.repeat(80));
                result.records.forEach((app) => {
                    console.log(`${app.id.toString().padEnd(5)} ${app.name.padEnd(20)} ${app.environment.padEnd(12)} ${app.status.padEnd(10)} Owner: ${app.ownerId}`);
                });
            }
            if (result.total > params.pageSize) {
                console.log(`\nShowing ${result.records.length} of ${result.total} applications`);
            }
        }
        catch (error) {
            console.error('✗ Failed to list applications:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // 6. import
    appCommand
        .command('import')
        .description('Batch import applications from CSV')
        .option('-f, --file <path>', 'CSV file path (required)')
        .option('--format <fmt>', 'File format: csv/json (default: csv)')
        .option('--preview', 'Preview import content, do not actually import')
        .option('--skip-errors', 'Skip error rows, continue importing')
        .option('--overwrite', 'Overwrite existing applications')
        .action(async (options) => {
        try {
            if (!options.file) {
                console.error('错误: --file 参数是必需的');
                process.exit(1);
            }
            const fs = require('fs');
            const path = require('path');
            if (!fs.existsSync(options.file)) {
                console.error(`✗ 文件不存在: ${options.file}`);
                process.exit(1);
            }
            const format = options.format || 'csv';
            let applications = [];
            if (format === 'csv') {
                applications = parseCSV(options.file);
            }
            else if (format === 'json') {
                const content = fs.readFileSync(options.file, 'utf-8');
                applications = JSON.parse(content);
            }
            if (options.preview) {
                console.log(`预览导入内容（共${applications.length}行）:`);
                console.log('─'.repeat(100));
                applications.slice(0, 5).forEach((app, idx) => {
                    console.log(`${idx + 1}. ${app.name || '(未命名)'} - 环境: ${app.environment || 'production'}`);
                });
                if (applications.length > 5) {
                    console.log(`... 还有 ${applications.length - 5} 行`);
                }
                return;
            }
            console.log(`开始导入 ${applications.length} 个应用...`);
            let successCount = 0;
            let failureCount = 0;
            const errors = [];
            for (let i = 0; i < applications.length; i++) {
                try {
                    const app = applications[i];
                    await ApiClient_1.default.post('/api/infra/applications', app);
                    successCount++;
                    console.log(`✓ [${i + 1}/${applications.length}] ${app.name}`);
                }
                catch (error) {
                    failureCount++;
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    errors.push({ row: i + 1, error: errorMsg });
                    if (!options.skipErrors) {
                        console.error(`✗ 导入失败，停止操作`);
                        process.exit(1);
                    }
                    console.warn(`⚠ [${i + 1}/${applications.length}] 导入失败: ${errorMsg}`);
                }
            }
            console.log('─'.repeat(50));
            console.log(`导入完成: 成功 ${successCount}, 失败 ${failureCount}`);
            if (errors.length > 0) {
                console.log('\n失败详情:');
                errors.slice(0, 10).forEach(e => {
                    console.log(`  行 ${e.row}: ${e.error}`);
                });
            }
        }
        catch (error) {
            console.error('✗ 导入失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // 7. export
    appCommand
        .command('export')
        .description('Export application inventory')
        .option('-f, --file <path>', 'Export file path (default: apps.csv)')
        .option('--format <fmt>', 'Export format: csv/json/excel (default: csv)')
        .option('-e, --environment <env>', 'Filter by environment for export')
        .option('-o, --owner-id <id>', 'Filter by owner for export')
        .option('-t, --tags <tags>', 'Filter by tags for export')
        .option('--include-resources', 'Include associated resources')
        .option('--include-costs', 'Include cost data')
        .action(async (options) => {
        try {
            const fs = require('fs');
            const path = require('path');
            const format = options.format || 'csv';
            const filePath = options.file || `apps.${format}`;
            // Build query parameters
            const filters = {};
            if (options.environment)
                filters.environment = options.environment;
            if (options.ownerId)
                filters.ownerId = options.ownerId;
            if (options.tags)
                filters.tags = options.tags;
            console.log(`正在导出应用清单到 ${filePath}...`);
            // fix: #1 https://github.com/remo-studio/solution-juren/issues/1
            // the filters and the "get all records" page size were built and then dropped —
            // an empty body was posted, so the export silently stopped at the default 20 rows
            const applications = await fetchAllApplications(filters);
            if (applications.length === 0) {
                console.warn('没有找到应用');
                return;
            }
            let content = '';
            if (format === 'csv') {
                // CSV header
                content = 'ID,名称,环境,状态,所有者,创建时间,描述\n';
                applications.forEach((app) => {
                    const row = [
                        app.id,
                        `"${app.name}"`,
                        app.environment,
                        app.status,
                        app.ownerId,
                        app.createdAt,
                        `"${(app.description || '').replace(/"/g, '""')}"`,
                    ].join(',');
                    content += row + '\n';
                });
            }
            else if (format === 'json') {
                content = JSON.stringify(applications, null, 2);
            }
            fs.writeFileSync(filePath, content, 'utf-8');
            console.log(`✓ 成功导出 ${applications.length} 个应用到 ${filePath}`);
            if (options.includeResources) {
                console.log('正在获取资源关联...');
                for (const app of applications) {
                    try {
                        const resources = await ApiClient_1.default.get(`/api/infra/applications/${app.id}/resources`);
                        console.log(`  ${app.name}: ${resources.length} 个资源`);
                    }
                    catch (error) {
                        // Skip resource fetch errors
                    }
                }
            }
        }
        catch (error) {
            console.error('✗ 导出失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // 8. tag
    appCommand
        .command('tag <app-id>')
        .description('Manage application tags')
        .option('--add <tags>', 'Add tags, comma-separated')
        .option('--remove <tags>', 'Remove tags, comma-separated')
        .option('--replace <tags>', 'Replace all tags, comma-separated')
        .option('--list', 'List all tags for application')
        .action(async (appId, options) => {
        try {
            if (options.list) {
                // List tags
                const app = await ApiClient_1.default.get(`/api/infra/applications/${appId}`);
                console.log(`应用 ${app.name} 的标签:`);
                if (app.tags && app.tags.length > 0) {
                    app.tags.forEach((tag) => {
                        console.log(`  - ${tag}`);
                    });
                }
                else {
                    console.log('  (无标签)');
                }
                return;
            }
            // Get current app
            const app = await ApiClient_1.default.get(`/api/infra/applications/${appId}`);
            let tags = app.tags || [];
            if (options.replace) {
                // Replace all tags
                tags = options.replace.split(',').map((t) => t.trim());
                console.log(`替换标签: ${tags.join(', ')}`);
            }
            else if (options.add) {
                // Add tags
                const newTags = options.add.split(',').map((t) => t.trim());
                tags = [...new Set([...tags, ...newTags])]; // Remove duplicates
                console.log(`添加标签: ${newTags.join(', ')}`);
            }
            else if (options.remove) {
                // Remove tags
                const removeTags = options.remove.split(',').map((t) => t.trim());
                tags = tags.filter((t) => !removeTags.includes(t));
                console.log(`删除标签: ${removeTags.join(', ')}`);
            }
            else {
                console.error('错误: 必须指定 --add, --remove 或 --replace 选项');
                process.exit(1);
            }
            // Update application with new tags
            const payload = { tags };
            await ApiClient_1.default.put(`/api/infra/applications/${appId}`, payload);
            console.log(`✓ 标签已更新: ${tags.join(', ') || '(无标签)'}`);
        }
        catch (error) {
            console.error('✗ 标签管理失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // 9. bind-resource
    appCommand
        .command('bind-resource <app-id>')
        .description('Associate resources to application')
        .option('--resource-ids <ids>', 'Resource ID list, comma-separated (required)')
        .option('--relation-type <type>', 'Relation type: primary/dependency/shared (default: primary)')
        .option('--replace', 'Replace all associations (default: add incrementally)')
        .action(async (appId, options) => {
        try {
            if (!options.resourceIds) {
                console.error('错误: --resource-ids 参数是必需的');
                process.exit(1);
            }
            const resourceIds = options.resourceIds
                .split(',')
                .map((id) => parseInt(id.trim()))
                .filter((id) => !isNaN(id));
            if (resourceIds.length === 0) {
                console.error('错误: 无效的资源ID');
                process.exit(1);
            }
            const relationType = options.relationType || 'primary';
            if (!['primary', 'dependency', 'shared'].includes(relationType)) {
                console.error('错误: 关联类型必须是 primary/dependency/shared');
                process.exit(1);
            }
            console.log(`绑定 ${resourceIds.length} 个资源到应用 ${appId}...`);
            // Bind resources
            const payload = {
                resourceIds,
                relationType,
                replace: options.replace || false,
            };
            await ApiClient_1.default.post(`/api/infra/applications/${appId}/resources`, resourceIds);
            console.log(`✓ 成功绑定 ${resourceIds.length} 个资源`);
            console.log(`  关联类型: ${relationType}`);
        }
        catch (error) {
            console.error('✗ 绑定资源失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // 10. unbind-resource
    appCommand
        .command('unbind-resource <app-id> <resource-id>')
        .description('Remove resource association')
        .action(async (appId, resourceId, options) => {
        try {
            const rid = parseInt(resourceId);
            if (isNaN(rid)) {
                console.error('错误: 无效的资源ID');
                process.exit(1);
            }
            console.log(`正在解绑资源 ${rid} 从应用 ${appId}...`);
            await ApiClient_1.default.delete(`/api/infra/applications/${appId}/resources/${rid}`);
            console.log(`✓ 成功解绑资源`);
        }
        catch (error) {
            console.error('✗ 解绑资源失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // 11. auto-bind
    appCommand
        .command('auto-bind')
        .description('Configure automatic resource association rules')
        .option('--add-rule', 'Add new rule')
        .option('--rule-name <name>', 'Rule name (required)')
        .option('--tag-key <key>', 'Tag key (required)')
        .option('--tag-value <value>', 'Tag value (optional, supports regex)')
        .option('--app-id <id>', 'Target application ID (required for --add-rule)')
        .option('--remove-rule <rule-id>', 'Delete rule')
        .option('--list-rules', 'List all rules')
        .option('--execute <rule-id>', 'Execute rule')
        .option('--dry-run', 'Preview only, do not actually execute')
        .action(async (options) => {
        try {
            if (options.listRules) {
                console.log('自动绑定规则列表:');
                console.log('─'.repeat(80));
                // TODO: Query rules from API
                console.log('(暂无规则)');
                return;
            }
            if (options.addRule) {
                if (!options.ruleName || !options.tagKey || !options.appId) {
                    console.error('错误: --rule-name, --tag-key 和 --app-id 是必需的');
                    process.exit(1);
                }
                const payload = {
                    ruleName: options.ruleName,
                    tagKey: options.tagKey,
                    tagValuePattern: options.tagValue || '.*',
                    targetAppId: parseInt(options.appId),
                    enabled: true,
                };
                // TODO: POST to auto-bind rule API
                console.log(`✓ 规则已创建: ${options.ruleName}`);
                console.log(`  标签键: ${options.tagKey}`);
                console.log(`  应用ID: ${options.appId}`);
                return;
            }
            if (options.removeRule) {
                // TODO: DELETE rule
                console.log(`✓ 规则 ${options.removeRule} 已删除`);
                return;
            }
            if (options.execute) {
                console.log(`执行规则 ${options.execute}...`);
                if (options.dryRun) {
                    console.log('(干运行模式 - 仅预览，不会实际执行)');
                }
                // TODO: Execute rule
                console.log('✓ 规则执行完成');
                return;
            }
            console.error('错误: 请指定 --add-rule, --remove-rule, --list-rules 或 --execute');
            process.exit(1);
        }
        catch (error) {
            console.error('✗ 自动绑定失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    // 12. health-check
    appCommand
        .command('health-check')
        .description('Perform application inventory health check')
        .option('--check-unassociated', 'Check unassociated applications')
        .option('--check-incomplete', 'Check incomplete applications')
        .option('--check-stale', 'Check stale applications')
        .option('--stale-days <num>', 'Stale threshold days (default: 30)')
        .option('--fix', 'Auto fix issues')
        .option('--json', 'JSON format output')
        .option('--report <file>', 'Generate report file')
        .action(async (options) => {
        try {
            console.log('执行应用清单健康检查...');
            console.log('─'.repeat(50));
            const staleDays = parseInt(options.staleDays) || 30;
            const issues = [];
            try {
                // fix: #1 https://github.com/remo-studio/solution-juren/issues/1
                // an empty body only returned the first default-sized page, so the health check
                // silently audited 20 applications and reported the result as a full inventory scan
                const allApps = await fetchAllApplications();
                // Check unassociated
                if (options.checkUnassociated) {
                    console.log(`检查未关联的应用...`);
                    for (const app of allApps) {
                        try {
                            const resources = await ApiClient_1.default.get(`/api/infra/applications/${app.id}/resources`);
                            if (!resources || resources.length === 0) {
                                issues.push({
                                    type: 'unassociated',
                                    appId: app.id,
                                    appName: app.name,
                                    severity: 'warning',
                                });
                                console.log(`  ⚠ ${app.name} 没有关联资源`);
                            }
                        }
                        catch (error) {
                            // Skip if resources API fails
                        }
                    }
                }
                // Check incomplete
                if (options.checkIncomplete) {
                    console.log(`检查不完整的应用...`);
                    allApps.forEach((app) => {
                        const incomplete = [];
                        if (!app.description)
                            incomplete.push('description');
                        if (!app.techStack)
                            incomplete.push('tech_stack');
                        if (!app.archType)
                            incomplete.push('architecture');
                        if (incomplete.length > 0) {
                            issues.push({
                                type: 'incomplete',
                                appId: app.id,
                                appName: app.name,
                                missingFields: incomplete,
                                severity: 'info',
                            });
                            console.log(`  ℹ ${app.name} 缺少字段: ${incomplete.join(', ')}`);
                        }
                    });
                }
                // Check stale
                if (options.checkStale) {
                    console.log(`检查陈旧应用 (${staleDays}天未更新)...`);
                    const staleDate = new Date();
                    staleDate.setDate(staleDate.getDate() - staleDays);
                    allApps.forEach((app) => {
                        if (new Date(app.updatedAt) < staleDate) {
                            issues.push({
                                type: 'stale',
                                appId: app.id,
                                appName: app.name,
                                lastUpdated: app.updatedAt,
                                severity: 'warning',
                            });
                            console.log(`  ⚠ ${app.name} 最后更新: ${app.updatedAt}`);
                        }
                    });
                }
                // Summary
                console.log('─'.repeat(50));
                console.log(`检查完成: 发现 ${issues.length} 个问题`);
                if (options.json) {
                    console.log('\n详细结果:');
                    console.log(JSON.stringify(issues, null, 2));
                }
                if (options.report) {
                    const fs = require('fs');
                    const report = {
                        timestamp: new Date().toISOString(),
                        totalApps: allApps.length,
                        issuesFound: issues.length,
                        issues,
                    };
                    fs.writeFileSync(options.report, JSON.stringify(report, null, 2), 'utf-8');
                    console.log(`\n✓ 报告已保存到 ${options.report}`);
                }
            }
            catch (error) {
                console.error('✗ 健康检查失败:', error instanceof Error ? error.message : String(error));
                process.exit(1);
            }
        }
        catch (error) {
            console.error('✗ 健康检查失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    return appCommand;
}
exports.registerAppCommands = registerAppCommands;
// Helper function to parse CSV
function parseCSV(filePath) {
    const fs = require('fs');
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter((l) => l.trim());
    if (lines.length < 2)
        return [];
    const headers = lines[0].split(',').map((h) => h.trim());
    const records = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
        const record = {};
        headers.forEach((header, idx) => {
            record[header.toLowerCase()] = values[idx];
        });
        records.push(record);
    }
    return records;
}
//# sourceMappingURL=index.js.map