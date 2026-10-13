import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import apiClient from '../../services/ApiClient';

function extractTitle(md: string, filePath: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  return path.basename(filePath, path.extname(filePath));
}

/** `| 文档编号 | PRD-good7ob-0004 |` -> `prd-0004`; undefined when the info table has no such row. */
export function extractPrdNo(md: string): string | undefined {
  const line = md.split('\n').find((l) => l.includes('文档编号'));
  const m = line?.match(/PRD(?:-[A-Za-z0-9_]+)*?-(\d+)/i);
  return m ? `prd-${m[1].padStart(4, '0')}` : undefined;
}

export function registerImportFileCommand(prdCommand: Command) {
  prdCommand
    .command('import-file')
    .description('把本地 PRD markdown 文件导入为平台上一个新的 PRD 会话（可在 /forge/prd 查看和编辑）')
    .argument('<file>', '本地 .md 文件路径')
    .option('--title <title>', '会话标题（默认从文件第一个 # 标题提取）')
    .option('--lang <language>', '文档语言（zh/en/ja）', 'zh')
    .option('--product-id <id>', '关联到的产品 ID（在 /forge/prd 用产品筛选器可查到）')
    .option('--prd-no <no>', 'PRD 编号（如 prd-0004，必须同时给 --product-id；默认从文档「文档编号」行自动提取）')
    .option('--json', '输出 JSON')
    .action(async (file: string, o) => {
      const filePath = path.resolve(file);
      if (!fs.existsSync(filePath)) {
        console.error(`✗ 文件不存在: ${filePath}`);
        process.exit(1);
      }
      const content = fs.readFileSync(filePath, 'utf8');
      const title = o.title || extractTitle(content, filePath);

      let prdNo: string | undefined = o.prdNo;
      if (prdNo && !o.productId) {
        console.error('✗ 参数错误: --prd-no 需要同时指定 --product-id');
        process.exit(1);
      }
      if (!prdNo) {
        prdNo = extractPrdNo(content);
        if (prdNo && !o.productId) {
          console.error(`⚠ 文档编号 ${prdNo} 未传 --product-id，按旧方式导入为新会话（不按编号去重）`);
          prdNo = undefined;
        }
      }

      try {
        const result = await apiClient.post('/forge/prd/import', {
          title,
          content,
          language: o.lang,
          productId: o.productId ? Number(o.productId) : undefined,
          prdNo,
        });

        if (o.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`✓ 导入成功`);
        if (result.prdId) console.log(`  PRD ID:   ${result.prdId}`);
        if (result.prdNo) console.log(`  PRD 编号: ${result.prdNo}`);
        if (result.unchanged) console.log('  内容未变，未新增版本');
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
