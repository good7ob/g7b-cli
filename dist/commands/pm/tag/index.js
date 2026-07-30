"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTagCommands = void 0;
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
function registerTagCommands(pmCommand) {
    const tagCommand = pmCommand
        .command('tag')
        .description('Tag management — list, create, delete');
    tagCommand
        .command('list')
        .description('List all tags (system and user-defined)')
        .option('--system', 'Show system tags only')
        .option('--user', 'Show user-defined tags only')
        .option('--json', 'Output as JSON')
        .action(async (options) => {
        try {
            let url = '/progress/tags';
            if (options.system)
                url = '/progress/tags/system';
            else if (options.user)
                url = '/progress/tags/user';
            const tags = await ApiClient_1.default.get(url);
            if (options.json) {
                console.log(JSON.stringify(tags, null, 2));
                return;
            }
            const list = Array.isArray(tags) ? tags : [];
            if (!list.length) {
                console.log('No tags found.');
                return;
            }
            console.log('\n标签列表');
            console.log('─'.repeat(50));
            console.log('ID'.padEnd(8) + '标签名'.padEnd(20) + '颜色'.padEnd(12) + '类型');
            console.log('─'.repeat(50));
            list.forEach((t) => {
                console.log(String(t.id).padEnd(8) +
                    (t.name || '').padEnd(20) +
                    (t.color || '-').padEnd(12) +
                    (t.isSystem ? 'system' : 'user'));
            });
            console.log('─'.repeat(50));
        }
        catch (error) {
            console.error('✗ 获取标签列表失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    tagCommand
        .command('create')
        .description('Create a user-defined tag')
        .requiredOption('--name <name>', 'Tag name')
        .option('--color <color>', 'Tag color (e.g. #FF5733)')
        .option('--json', 'Output result as JSON')
        .action(async (options) => {
        try {
            const body = { name: options.name };
            if (options.color)
                body.color = options.color;
            const tag = await ApiClient_1.default.post('/progress/tags', body);
            if (options.json) {
                console.log(JSON.stringify(tag, null, 2));
                return;
            }
            console.log(`✓ 标签已创建: [${tag?.id || ''}] ${options.name}`);
        }
        catch (error) {
            console.error('✗ 创建标签失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    tagCommand
        .command('delete <id>')
        .description('Delete a user-defined tag')
        .option('-f, --force', 'Skip confirmation prompt')
        .action(async (id, options) => {
        try {
            if (!options.force) {
                console.log(`⚠ 即将删除标签 ${id}，使用 -f/--force 确认删除`);
                process.exit(0);
            }
            await ApiClient_1.default.delete(`/progress/tags/${id}`);
            console.log(`✓ 标签已删除: ${id}`);
        }
        catch (error) {
            console.error('✗ 删除标签失败:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
    return tagCommand;
}
exports.registerTagCommands = registerTagCommands;
//# sourceMappingURL=index.js.map