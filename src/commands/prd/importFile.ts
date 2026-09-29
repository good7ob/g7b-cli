import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import apiClient from '../../services/ApiClient';

function extractTitle(md: string, filePath: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  return path.basename(filePath, path.extname(filePath));
}

export function registerImportFileCommand(prdCommand: Command) {
  prdCommand
    .command('import-file')
    .description('把本地 PRD markdown 文件导入为平台上一个新的 PRD 会话（可在 /forge/prd 查看和编辑）')
    .argument('<file>', '本地 .md 文件路径')
    .option('--title <title>', '会话标题（默认从文件第一个 # 标题提取）')
    .option('--lang <language>', '文档语言（zh/en/ja）', 'zh')
    .option('--json', '输出 JSON')
    .action(async (file: string, o) => {
      const filePath = path.resolve(file);
      if (!fs.existsSync(filePath)) {
        console.error(`✗ 文件不存在: ${filePath}`);
        process.exit(1);
      }
      const content = fs.readFileSync(filePath, 'utf8');
      const title = o.title || extractTitle(content, filePath);

      try {
        const result = await apiClient.post('/forge/prd/import', {
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
      } catch (e: any) {
        console.error('✗ 导入失败:', e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });
}
