/**
 * `good7ob artifact` (prd-0126 FP-7): register wireframe / ddd files against the rule points they cite, and read
 * the per-rule-point progress. Reads files locally and talks to the platform only; nothing is written to the repo.
 */
import { Command } from 'commander';
import * as path from 'path';
import apiClient from '../../services/ApiClient';
import { InputError, emit, guarded, parseId, renderTable, requireOneOf } from '../../utils/cliHelpers';
import { headSha, remoteUrl } from './git';
import {
  BATCH_SIZE, COUNTED_STAGES, DEFAULT_EXTENSIONS, FULL_SCAN_MAX, KINDS, ProgressRow, RuleProgress, STAGE_LABEL,
  SyncResult, batchesOf, buildItems, mergeResults, renderSyncSummary, repoFromRemote, ruleCell, scanDir, stageCell,
} from './logic';

const LEVELS = ['prd', 'fp', 'rp'] as const;
const CODES = {
  1001: '参数不合法（整批未写入）',
  1002: '产品不存在或没有访问权限',
};

type ProductOpt = { product?: string; json?: boolean };

function productId(o: ProductOpt): number {
  return parseId(o.product ?? process.env.GOOD7OB_PRODUCT_ID, '--product（或环境变量 GOOD7OB_PRODUCT_ID）');
}

const base = (id: number): string => `/artifact-progress/products/${id}`;

interface SyncOpts extends ProductOpt {
  repo?: string;
  dir: string;
  kind: string;
  ext?: string;
  fullScan?: boolean;
  dryRun?: boolean;
}

/** rp-pm-artifact-0044: without rule points nothing can be linked, so refuse before reading any file. */
async function requireRulePoints(id: number): Promise<void> {
  const data = await apiClient.get(`${base(id)}/progress`, { level: 'prd' });
  const rows: ProgressRow[] = data?.rows ?? [];
  if (rows.reduce((sum, r) => sum + (r.ruleCount ?? 0), 0) === 0) {
    throw new InputError(
      `产品 ${id} 下还没有任何 RP，无法建立关联。请先导入需求结构：good7ob prd import-structure --prd-dir <docs/prd> --product ${id} --tenant <组织ID>`);
  }
}

function repoOf(o: SyncOpts, dir: string): string {
  const explicit = o.repo;
  if (explicit) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(explicit)) throw new InputError(`--repo 必须是 owner/name 格式，收到: ${explicit}`);
    return explicit;
  }
  const fromGit = repoFromRemote(remoteUrl(dir) ?? '');
  if (!fromGit) throw new InputError('无法从 git remote 判断仓库，请用 --repo owner/name 指定');
  return fromGit;
}

export function registerArtifactCommands(program: Command) {
  const cmd = program
    .command('artifact')
    .description('项目资源进度跟踪：把 wireframe / ddd 文件按正文里的 RP 编号登记并关联，逐条查看 RP 的阶段进度（prd-0126）');

  cmd.command('sync')
    .description('扫描目录里的 wireframe / ddd 文件，按「仓库 + 路径」同步到平台，并按正文中的 rp-xxx-NNNN 建立关联')
    .option('--product <id>', '产品 ID（或环境变量 GOOD7OB_PRODUCT_ID）')
    .option('--dir <path>', '要扫描的目录，应为仓库根目录（路径以它为基准）', '.')
    .option('--repo <owner/name>', '仓库全名；默认取 git remote origin')
    .option('--kind <kind>', `资源类型：${KINDS.join(' | ')} | auto（按文件名 arc- / db- / api- 判断）`, 'auto')
    .option('--ext <list>', `参与扫描的扩展名，逗号分隔，默认 ${DEFAULT_EXTENSIONS.join(',')}`)
    .option('--full-scan', `仓库里已不存在的已登记文件标记为 removed（一次最多 ${FULL_SCAN_MAX} 份）`)
    .option('--dry-run', '只与平台比对并报告新增 / 更新 / 移除，不写入')
    .option('--json', '输出 JSON')
    .action((o: SyncOpts) => guarded('同步失败', CODES, async () => {
      const id = productId(o);
      const kind = o.kind === 'auto' ? 'auto' : requireOneOf(o.kind, KINDS, '--kind');
      const dir = path.resolve(o.dir);
      const extensions = o.ext ? o.ext.split(',').map((e) => (e.trim().startsWith('.') ? e.trim() : `.${e.trim()}`)) : DEFAULT_EXTENSIONS;
      await requireRulePoints(id);

      const { items, undecided } = buildItems(scanDir(dir, extensions), repoOf(o, dir), headSha(dir) ?? undefined, kind);
      if (items.length === 0) {
        throw new InputError(`没有可同步的文件（目录 ${dir}，扩展名 ${extensions.join('/')}）${undecided.length ? `；${undecided.length} 个文件无法判断类型，请用 --kind 指定` : ''}`);
      }
      if (o.fullScan && items.length > FULL_SCAN_MAX) {
        throw new InputError(`--full-scan 一次最多 ${FULL_SCAN_MAX} 份，当前 ${items.length}。请缩小 --dir，或去掉 --full-scan`);
      }
      const batches = o.fullScan ? [items] : batchesOf(items, BATCH_SIZE);
      const results: SyncResult[] = [];
      for (const batch of batches) {
        results.push(await apiClient.post(`${base(id)}/artifacts/sync`, { items: batch, fullScan: !!o.fullScan, dryRun: !!o.dryRun }));
      }
      const merged = mergeResults(results);
      emit(o.json, merged, () => [
        renderSyncSummary(merged),
        ...(undecided.length ? [`跳过 ${undecided.length} 个无法判断类型的文件（用 --kind 指定）：${undecided.slice(0, 5).join(', ')}${undecided.length > 5 ? ' …' : ''}`] : []),
      ].join('\n'));
      if ((merged.counts.failed ?? 0) > 0) process.exit(1);
    }));

  cmd.command('status')
    .description('查看进度：level=prd / fp / rp，按 PRD、FP、阶段筛选；「只看未开始」需要同时指定 --stage')
    .option('--product <id>', '产品 ID（或环境变量 GOOD7OB_PRODUCT_ID）')
    .option('--level <level>', `汇总层级：${LEVELS.join(' | ')}`, 'prd')
    .option('--prd <prdNo>', '只看某份 PRD，如 prd-0123')
    .option('--fp <code>', '只看某个 FP，如 fun-pm-ledger-0001')
    .option('--rp <code>', '只看某条 RP（level=rp 时），如 rp-pm-ledger-0001')
    .option('--stage <stage>', `阶段：${COUNTED_STAGES.join(' | ')}`)
    .option('--only-stale', '只看有过期资源的')
    .option('--only-not-started', '只看指定阶段还没开始的（需要 --stage）')
    .option('--json', '输出 JSON')
    .action((o: ProductOpt & { level: string; prd?: string; fp?: string; rp?: string; stage?: string; onlyStale?: boolean; onlyNotStarted?: boolean }) =>
      guarded('读取失败', CODES, async () => {
        const id = productId(o);
        const level = requireOneOf(o.level, LEVELS, '--level');
        if (o.stage) requireOneOf(o.stage, COUNTED_STAGES, '--stage');
        if (o.onlyNotStarted && !o.stage) throw new InputError('--only-not-started 需要同时指定 --stage');
        const data = await apiClient.get(`${base(id)}/progress`, {
          level, prd: o.prd, fp: o.fp, stage: o.stage,
          onlyStale: o.onlyStale ? true : undefined, onlyNotStarted: o.onlyNotStarted ? true : undefined,
        });
        if (level === 'rp') {
          const rules: RuleProgress[] = (data?.rules ?? []).filter((r: RuleProgress) => !o.rp || r.code === o.rp.toLowerCase());
          return emit(o.json, rules, () => rules.length === 0 ? '没有符合条件的 RP'
            : renderTable([['RP', 'FP', ...Object.values(STAGE_LABEL)],
              ...rules.map((r) => [r.code, r.fpCode ?? '—', ...Object.keys(STAGE_LABEL).map((s) => ruleCell(r, s))])]));
        }
        const rows: ProgressRow[] = data?.rows ?? [];
        emit(o.json, rows, () => rows.length === 0 ? '没有符合条件的记录'
          : renderTable([[level === 'prd' ? 'PRD' : 'FP', '名称', 'RP 数', ...COUNTED_STAGES.map((s) => STAGE_LABEL[s])],
            ...rows.map((r) => [r.key || '—', r.name ?? '—', r.stages ? String(r.ruleCount) : '—', ...COUNTED_STAGES.map((s) => stageCell(r, s))])]));
      }));
}
