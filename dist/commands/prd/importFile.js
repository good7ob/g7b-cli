"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerImportFileCommand = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
function extractTitle(md, filePath) {
    const m = md.match(/^#\s+(.+)$/m);
    if (m)
        return m[1].trim();
    return path_1.default.basename(filePath, path_1.default.extname(filePath));
}
function registerImportFileCommand(prdCommand) {
    prdCommand
        .command('import-file')
        .description('把本地 PRD markdown 文件导入为平台上一个新的 PRD 会话（可在 /forge/prd 查看和编辑）')
        .argument('<file>', '本地 .md 文件路径')
        .option('--title <title>', '会话标题（默认从文件第一个 # 标题提取）')
        .option('--lang <language>', '文档语言（zh/en/ja）', 'zh')
        .option('--json', '输出 JSON')
        .action(async (file, o) => {
        const filePath = path_1.default.resolve(file);
        if (!fs_1.default.existsSync(filePath)) {
            console.error(`✗ 文件不存在: ${filePath}`);
            process.exit(1);
        }
        const content = fs_1.default.readFileSync(filePath, 'utf8');
        const title = o.title || extractTitle(content, filePath);
        try {
            const result = await ApiClient_1.default.post('/forge/prd/import', {
                title,
                content,
                language: o.lang,
            });
            if (o.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            console.log(`✓ 导入成功`);
            console.log(`  会话 ID:  ${result.sessionId}`);
            console.log(`  文档 ID:  ${result.documentId}`);
            console.log(`  标题:     ${result.title}`);
            console.log(`  查看:     ${result.viewUrl || `（在 good7ob 平台 /forge/prd 搜索"${title}"）`}`);
        }
        catch (e) {
            console.error('✗ 导入失败:', e instanceof Error ? e.message : String(e));
            process.exit(1);
        }
    });
}
exports.registerImportFileCommand = registerImportFileCommand;
//# sourceMappingURL=importFile.js.map