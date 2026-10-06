import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import apiClient from '../../services/ApiClient';
import { buildImportPayloads, FilePayload, summarizePayloads } from './importPayload';
import { buildDesired, loadStructure, parseVerified, summarize } from './structure';

/**
 * `good7ob prd import-structure` — external structured import (prd-0076 FP-9). Parses docs/prd (requirement
 * index + FP/RP tables) into one body per PRD file and sends it to `POST /forge/structuring/import`; the
 * server validates the whole file, writes idempotently by business code, and returns the report. No Credits.
 */

const LAYER_CN: Record<string, string> = { feature: 'Feature', fp: 'FP', rp: 'RP' };

function positiveInt(value: string | undefined, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} 必须是正整数${value === undefined ? `（缺少 ${flag}，仅 --parse-only 可省略）` : `: ${value}`}`);
  return n;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`无法读取 --verified 文件 ${file}: ${e instanceof Error ? e.message : e}`);
  }
}

const dist = (counts: Record<string, number>) => Object.entries(counts).map(([k, v]) => `${k} ${v}`).join('  ');

export function cliTool(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'));
    return `g7b-cli@${pkg.version}`;
  } catch {
    return 'g7b-cli';
  }
}

export interface ServerReport {
  status: string; reportId?: number;
  counts: Record<string, { created: number; updated: number; unchanged: number; failed: number }>;
  errors: { layer: string; code: string; line?: number; message: string }[];
  changes: { code: string; field: string; from?: string; to?: string }[];
  completeness: string[]; notes: string[];
}

export function printReport(file: string, r: ServerReport) {
  console.log(`\n${file}  [${r.status}]${r.reportId ? `  报告 #${r.reportId}` : ''}`);
  if (r.status === 'REJECTED') {
    console.log(`  整份拒绝，未写入任何节点，共 ${r.errors.length} 处错误：`);
    r.errors.forEach((e) => console.log(`  ✗ ${file}${e.line ? `:${e.line}` : ''}  ${e.code}  ${e.message}`));
  } else {
    console.log(`  ${''.padEnd(10)}${'新建'.padEnd(8)}${'更新'.padEnd(8)}${'未变'.padEnd(8)}失败`);
    Object.entries(r.counts).forEach(([layer, c]) =>
      console.log(`  ${(LAYER_CN[layer] ?? layer).padEnd(10)}${String(c.created).padEnd(10)}${String(c.updated).padEnd(10)}${String(c.unchanged).padEnd(10)}${c.failed}`));
    r.changes.forEach((c) => console.log(`  ↻ ${c.code}  ${c.field}: ${c.from ?? ''} → ${c.to ?? ''}`));
  }
  r.completeness.forEach((m) => console.log(`  ⚠ 完成度  ${m}`));
  r.notes.forEach((m) => console.log(`  ℹ ${m}`));
}

export async function sendAll(client: { post(url: string, body?: any): Promise<any> }, payloads: FilePayload[]) {
  const reports: { file: string; report: ServerReport }[] = [];
  for (const { file, payload } of payloads) {
    reports.push({ file, report: await client.post('/forge/structuring/import', payload) });
  }
  return reports;
}

export function registerImportStructureCommand(prdCommand: Command) {
  prdCommand
    .command('import-structure')
    .description('外部结构化导入：把 docs/prd 需求结构（索引 + FP/RP 表）按 PRD 文件整份校验、幂等导入产品的 Feature / FP / RP（不扣 Credits，不删除）')
    .requiredOption('--prd-dir <path>', 'docs/prd 目录（含 prd-0000 需求索引）')
    .option('--product <id>', '目标产品 ID（--parse-only 时可省略）')
    .option('--tenant <id>', '组织 ID（= tenant_id，须与产品所属组织一致；--parse-only 时可省略）')
    .option('--verified <json>', '代码核实结果 JSON：{ fpStatus: {funId: DONE|PARTIAL|TODO}, rpImplStatus: {rpId: TODO|UNVERIFIED} }')
    .option('--dry-run', '只校验并比对，不写入（服务端不保留报告）')
    .option('--only-files <files>', '只处理指定文件（逗号分隔，支持相对路径或文件名，如 prd-0088-good7ob-forge-idea-management.md）')
    .option('--parse-only', '只解析本地文件并打印统计，不调用 API')
    .option('--json', '输出 JSON')
    .action(async (o) => {
      try {
        const verified = o.verified ? parseVerified(readJson(o.verified)) : undefined;
        const onlyFiles = o.onlyFiles ? new Set<string>(o.onlyFiles.split(',').map((f: string) => f.trim())) : undefined;
        const parsedStructure = loadStructure(path.resolve(o.prdDir), onlyFiles);
        const { features, warnings: parseWarnings } = buildDesired(parsedStructure, verified);
        const parsed = summarize(features);

        if (o.parseOnly) {
          if (o.json) { console.log(JSON.stringify({ parsed, warnings: parseWarnings }, null, 2)); return; }
          parseWarnings.forEach((w) => console.error(`⚠ ${w}`));
          console.log(`解析结果   Feature ${parsed.features}   FP ${parsed.fps}   RP ${parsed.rps}`);
          console.log(`FP 状态    ${dist(parsed.fpStatus)}`);
          console.log(`RP 实现    ${dist(parsed.rpImplStatus)}`);
          return;
        }

        const productId = positiveInt(o.product, '--product');
        const tenantId = positiveInt(o.tenant, '--tenant');
        const { payloads, warnings } = buildImportPayloads(parsedStructure,
          { tenantId, productId, tool: cliTool(), dryRun: !!o.dryRun, verified });
        if (!o.json) warnings.forEach((w) => console.error(`⚠ ${w}`));

        const reports = await sendAll(apiClient, payloads);
        const rejected = reports.filter((r) => r.report.status === 'REJECTED');
        if (o.json) {
          console.log(JSON.stringify({ sent: summarizePayloads(payloads), warnings, reports }, null, 2));
        } else {
          reports.forEach((r) => printReport(r.file, r.report));
          console.log(o.dryRun ? '\n（--dry-run，未写入）' : `\n${rejected.length ? '✗' : '✓'} 导入完成 — 产品 ${productId}，${reports.length} 个 PRD 文件，${rejected.length} 个被拒绝`);
        }
        if (rejected.length) process.exit(1);
      } catch (e: any) {
        console.error('✗ 导入需求结构失败:', e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });
}
