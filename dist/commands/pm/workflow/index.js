"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkflowCommands = void 0;
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
function registerWorkflowCommands(pmCommand) {
    const workflowCommand = pmCommand
        .command('workflow')
        .description('Workflow management — templates, stages, dependencies');
    workflowCommand
        .command('templates')
        .description('List available workflow templates')
        .option('--json', 'Output as JSON')
        .action(async (options) => {
        try {
            const templates = await ApiClient_1.default.get('/progress/workflows/templates');
            if (options.json) {
                console.log(JSON.stringify(templates, null, 2));
                return;
            }
            const list = Array.isArray(templates) ? templates : [];
            if (!list.length) {
                console.log('No workflow templates found.');
                return;
            }
            console.log('\n工作流模板列表');
            console.log('─'.repeat(70));
            console.log('ID'.padEnd(8) + '模板名称'.padEnd(30) + '阶段数'.padEnd(10) + '描述');
            console.log('─'.repeat(70));
            list.forEach((t) => {
                console.log(String(t.id).padEnd(8) +
                    (t.name || '').substring(0, 28).padEnd(30) +
                    String(t.stageCount || t.stages?.length || 0).padEnd(10) +
                    (t.description || '-').substring(0, 20));
            });
            console.log('─'.repeat(70));
        }
        catch (error) {
            console.error('✗ 获取模板列表失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    workflowCommand
        .command('template-get <id>')
        .description('Get workflow template details with stages')
        .option('--json', 'Output as JSON')
        .action(async (id, options) => {
        try {
            const template = await ApiClient_1.default.get(`/progress/workflows/templates/${id}`);
            if (options.json) {
                console.log(JSON.stringify(template, null, 2));
                return;
            }
            console.log('\n工作流模板详情');
            console.log('─'.repeat(50));
            console.log(`ID:   ${template.id}`);
            console.log(`名称: ${template.name}`);
            console.log(`描述: ${template.description || '-'}`);
            const stages = template.stages || [];
            if (stages.length) {
                console.log('\n阶段列表:');
                stages.forEach((s, i) => {
                    console.log(`  ${i + 1}. [${s.id}] ${s.name} — ${s.description || ''}`);
                });
            }
            console.log('─'.repeat(50));
        }
        catch (error) {
            console.error('✗ 获取模板详情失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    workflowCommand
        .command('start')
        .description('Apply a workflow template to a task')
        .requiredOption('--task-id <id>', 'Task ID')
        .requiredOption('--template-id <id>', 'Workflow template ID')
        .action(async (options) => {
        try {
            await ApiClient_1.default.post('/progress/workflows/start', {
                taskId: parseInt(options.taskId),
                templateId: parseInt(options.templateId),
            });
            console.log(`✓ 工作流已启动: 任务 ${options.taskId} 使用模板 ${options.templateId}`);
        }
        catch (error) {
            console.error('✗ 启动工作流失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    workflowCommand
        .command('complete-stage <task-id>')
        .description('Complete the current workflow stage for a task')
        .option('--output <text>', 'Stage completion output/notes')
        .action(async (taskId, options) => {
        try {
            const body = {};
            if (options.output)
                body.output = options.output;
            await ApiClient_1.default.post(`/progress/workflows/${taskId}/stages/complete`, body);
            console.log(`✓ 当前阶段已完成: 任务 ${taskId}`);
        }
        catch (error) {
            console.error('✗ 完成阶段失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    workflowCommand
        .command('next-action <task-id>')
        .description('Get the next action for a task in its workflow')
        .option('--json', 'Output as JSON')
        .action(async (taskId, options) => {
        try {
            const action = await ApiClient_1.default.get(`/progress/workflows/${taskId}/next-action`);
            if (options.json) {
                console.log(JSON.stringify(action, null, 2));
                return;
            }
            console.log(`\n任务 ${taskId} — 下一步操作`);
            console.log('─'.repeat(50));
            console.log(`操作:     ${action?.action || action?.nextAction || '-'}`);
            console.log(`当前阶段: ${action?.currentStage || '-'}`);
            console.log(`说明:     ${action?.description || '-'}`);
            console.log('─'.repeat(50));
        }
        catch (error) {
            console.error('✗ 获取下一步操作失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    workflowCommand
        .command('project-status <project-id>')
        .description('Get workflow status for all tasks in a project')
        .option('--json', 'Output as JSON')
        .action(async (projectId, options) => {
        try {
            const statuses = await ApiClient_1.default.get(`/progress/workflows/project/${projectId}`);
            if (options.json) {
                console.log(JSON.stringify(statuses, null, 2));
                return;
            }
            const list = Array.isArray(statuses) ? statuses : [];
            console.log(`\n工作流状态 — 项目 ${projectId}`);
            console.log('─'.repeat(80));
            console.log('任务ID'.padEnd(10) + '任务名称'.padEnd(25) + '当前阶段'.padEnd(20) + '工作流状态');
            console.log('─'.repeat(80));
            list.forEach((s) => {
                console.log(String(s.taskId || s.id).padEnd(10) +
                    (s.taskName || s.name || '').substring(0, 23).padEnd(25) +
                    (s.currentStage || '-').padEnd(20) +
                    (s.workflowStatus || s.status || '-'));
            });
            console.log('─'.repeat(80));
        }
        catch (error) {
            console.error('✗ 获取项目工作流状态失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    workflowCommand
        .command('add-dependency')
        .description('Add a dependency between tasks')
        .requiredOption('--task-id <id>', 'Task ID (the dependent task)')
        .requiredOption('--depends-on <id>', 'Task ID that must complete first')
        .option('--type <type>', 'Dependency type', 'finish_to_start')
        .action(async (options) => {
        try {
            await ApiClient_1.default.post('/progress/workflows/dependencies', {
                taskId: parseInt(options.taskId),
                dependsOnTaskId: parseInt(options.dependsOn),
                dependencyType: options.type,
            });
            console.log(`✓ 依赖关系已添加: 任务 ${options.taskId} 依赖于任务 ${options.dependsOn}`);
        }
        catch (error) {
            console.error('✗ 添加依赖关系失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    workflowCommand
        .command('dependencies <task-id>')
        .description('Get dependencies for a task')
        .option('--json', 'Output as JSON')
        .action(async (taskId, options) => {
        try {
            const deps = await ApiClient_1.default.get(`/progress/workflows/dependencies/${taskId}`);
            if (options.json) {
                console.log(JSON.stringify(deps, null, 2));
                return;
            }
            const list = Array.isArray(deps) ? deps : [];
            console.log(`\n任务依赖 — 任务 ${taskId}`);
            console.log('─'.repeat(60));
            console.log('依赖任务ID'.padEnd(12) + '依赖任务名称'.padEnd(25) + '依赖类型');
            console.log('─'.repeat(60));
            list.forEach((d) => {
                console.log(String(d.dependsOnTaskId || d.taskId).padEnd(12) +
                    (d.taskName || '-').substring(0, 23).padEnd(25) +
                    (d.dependencyType || d.type || '-'));
            });
            console.log('─'.repeat(60));
        }
        catch (error) {
            console.error('✗ 获取任务依赖失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    return workflowCommand;
}
exports.registerWorkflowCommands = registerWorkflowCommands;
//# sourceMappingURL=index.js.map