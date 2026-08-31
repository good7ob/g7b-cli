import { Command } from 'commander';
import * as fs from 'fs';
import * as readline from 'readline';
import apiClient from '../../services/ApiClient';
import { extractRecords } from '../../utils/extractRecords';

/**
 * SES 案件导入命令（g7b #1008）。
 *
 * 走 /forge/cases/ai + /forge/cases/submit（普通登录态即可，不需要 admin 权限）——
 * 跟 front-admin AddCaseDialog.vue 用的 /admin/api/cases/ai + /admin/api/cases/create
 * 是同一套 AI 识别/查重逻辑，只是提交方是普通用户而不是 admin，所以落地后进入待审核
 * 队列（auditStatus=REVIEW），要 admin 审核通过才会对外可见，而不是直接发布。
 */

interface CaseDTO {
  id?: number;
  caseName?: string;
  caseContent?: string;
  caseCategory?: string;
  techCategory?: string;
  startDate?: string;
  endDate?: string;
  workPlace?: string;
  workAddress?: string;
  mustElements?: string;
  publisher?: string;
  publisherContact?: string;
  publisherSource?: string;
  duplicateId?: number;
  [key: string]: any;
}

function fail(message: string, error: unknown): never {
  console.error(`✗ ${message}:`, error instanceof Error ? error.message : String(error));
  process.exit(1);
}

/** Read all of stdin as text — used when neither `<text...>` nor `--file` is given. */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function resolveContent(textParts: string[], filePath?: string): Promise<string> {
  if (filePath) {
    return fs.readFileSync(filePath, 'utf8');
  }
  if (textParts.length) {
    return textParts.join(' ');
  }
  if (!process.stdin.isTTY) {
    return readStdin();
  }
  return '';
}

/** Single y/N prompt — no interactive-prompt dependency needed for one question. */
function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function printCase(index: number, c: CaseDTO): void {
  const dup = c.duplicateId ? `  ⚠ 疑似重复 (已存在案件 #${c.duplicateId})` : '';
  console.log(`\n[${index + 1}] ${c.caseName || '(无标题)'}${dup}`);
  if (c.caseCategory) console.log(`    种别:     ${c.caseCategory}`);
  if (c.techCategory) console.log(`    技能:     ${c.techCategory}`);
  if (c.workPlace || c.workAddress) {
    console.log(`    作业场所: ${[c.workPlace, c.workAddress].filter(Boolean).join(' / ')}`);
  }
  if (c.startDate || c.endDate) {
    console.log(`    作业期间: ${c.startDate || '?'} ~ ${c.endDate || '?'}`);
  }
  if (c.mustElements) console.log(`    薪资/条件: ${c.mustElements}`);
  if (c.publisher) console.log(`    发布者:   ${c.publisher}${c.publisherContact ? ` (${c.publisherContact})` : ''}`);
}

export function registerCaseCommands(program: Command) {
  const caseCommand = program
    .command('case')
    .description('SES 案件管理 — AI 识别粘贴内容并批量提交待审核 (g7b #1008)');

  caseCommand
    .command('import [text...]')
    .description(
      '粘贴/管道输入 SES 案件信息（可一段内含多条），AI 解析后确认批量提交待审核。' +
        '不给 text 且不给 --file 时从 stdin 读取。'
    )
    .option('-f, --file <path>', '从文件读取原始内容，而不是命令行参数/stdin')
    .option('--dry-run', '只做 AI 识别并展示结果，不提交')
    .option('-y, --yes', '跳过确认提示，识别后直接提交')
    .option('--json', '以 JSON 输出识别/写入结果')
    .action(async (textParts: string[], options) => {
      try {
        const content = await resolveContent(textParts, options.file);
        if (!content.trim()) {
          fail(
            '没有可识别的内容',
            new Error('传入案件文本，或使用 --file <path>，或通过管道输入')
          );
        }

        const parsed = await apiClient.post<CaseDTO[]>('/forge/cases/ai', content);
        const cases = extractRecords<CaseDTO>(parsed);

        if (!cases.length) {
          console.error('✗ AI 未能从内容中识别出案件信息，请检查粘贴内容或手动在网页端录入');
          process.exit(1);
        }

        if (options.json && options.dryRun) {
          console.log(JSON.stringify(cases, null, 2));
          return;
        }

        console.log(`识别到 ${cases.length} 条案件：`);
        cases.forEach((c, i) => printCase(i, c));

        if (options.dryRun) {
          console.log(`\n(--dry-run，未提交)`);
          return;
        }

        console.log('');
        if (!options.yes && !(await confirm(`确认提交以上 ${cases.length} 条案件待审核？`))) {
          console.log('已取消，未提交。');
          return;
        }

        const result = await apiClient.post('/forge/cases/submit', cases);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const savedCount = result?.savedCount ?? cases.length;
        console.log(`✓ 已提交 ${savedCount} 条案件，等待 admin 审核通过后对外可见`);
        if (result?.skippedCount) {
          console.log(`  跳过 ${result.skippedCount} 条重复案件: ${(result.skippedCaseNames || []).join('、')}`);
        }
      } catch (error) {
        // 提交的全部是重复案件时后端返回 1006——不是异常情况，给出针对性提示。
        if ((error as any)?.code === 1006) {
          console.error('✗ 这些案件都已存在，未提交任何内容');
          process.exit(1);
        }
        fail('提交案件失败', error);
      }
    });
}
