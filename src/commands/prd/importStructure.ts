import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import apiClient from '../../services/ApiClient';
import { buildDesired, loadStructure, parseVerified, summarize, SyncResult, syncStructure } from './structure';

/**
 * `good7ob prd import-structure` — import docs/prd (requirement index + FP/RP tables) into a product's
 * Feature / Function Point / Rule Point tree via /forge/features, /forge/function-points, /forge/rule-points.
 */

const LAYER_CN: Record<string, string> = { feature: 'Feature', fp: 'FP', rp: 'RP' };
const OP_ICON: Record<string, string> = { create: '＋', update: '↻' };

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

function printCounts(result: SyncResult) {
  console.log(`\n${''.padEnd(10)}${'新建'.padEnd(8)}${'更新'.padEnd(8)}不变`);
  (Object.keys(result.counts) as (keyof SyncResult['counts'])[]).forEach((layer) => {
    const c = result.counts[layer];
    console.log(`${LAYER_CN[layer].padEnd(10)}${String(c.create).padEnd(10)}${String(c.update).padEnd(10)}${c.unchanged}`);
  });
}

export function registerImportStructureCommand(prdCommand: Command) {
  prdCommand
    .command('import-structure')
    .description('把 docs/prd 需求结构幂等导入产品的 Feature / Function Point / Rule Point（重复执行只补缺失、只改变化的状态，不删除）')
    .requiredOption('--prd-dir <path>', 'docs/prd 目录（含 prd-0000 需求索引）')
    .option('--product <id>', '目标产品 ID（--parse-only 时可省略）')
    .option('--verified <json>', '代码核实结果 JSON：{ fpStatus: {funId: DONE|PARTIAL|TODO}, rpImplStatus: {rpId: TODO|UNVERIFIED} }')
    .option('--dry-run', '读取现有数据并打印计划，不写入')
    .option('--parse-only', '只解析本地文件并打印统计，不调用 API')
    .option('--concurrency <n>', '并发处理的 Feature 数', '4')
    .option('--json', '输出 JSON')
    .action(async (o) => {
      try {
        const verified = o.verified ? parseVerified(readJson(o.verified)) : undefined;
        const { features, warnings } = buildDesired(loadStructure(path.resolve(o.prdDir)), verified);
        const parsed = summarize(features);
        if (!o.json) warnings.forEach((w) => console.error(`⚠ ${w}`));

        if (o.parseOnly) {
          if (o.json) { console.log(JSON.stringify({ parsed, warnings }, null, 2)); return; }
          console.log(`解析结果   Feature ${parsed.features}   FP ${parsed.fps}   RP ${parsed.rps}`);
          console.log(`FP 状态    ${dist(parsed.fpStatus)}`);
          console.log(`RP 实现    ${dist(parsed.rpImplStatus)}`);
          return;
        }

        const productId = positiveInt(o.product, '--product');
        const concurrency = positiveInt(o.concurrency, '--concurrency');
        const result = await syncStructure(apiClient, productId, features, { dryRun: !!o.dryRun, concurrency });

        if (o.json) { console.log(JSON.stringify({ parsed, warnings, dryRun: !!o.dryRun, ...result }, null, 2)); return; }
        result.actions.forEach((a) => console.log(
          `  ${OP_ICON[a.op]} ${LAYER_CN[a.layer].padEnd(8)}${a.id}${a.field ? `  ${a.field}: ${a.from} → ${a.to}` : ''}`));
        printCounts(result);
        console.log(o.dryRun ? '\n（--dry-run，未写入）' : `\n✓ 导入完成 — 产品 ${productId}`);
      } catch (e: any) {
        if (e?.partial) {
          console.error('中断前已处理：');
          printCounts(e.partial);
        }
        console.error('✗ 导入需求结构失败:', e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
    });
}
