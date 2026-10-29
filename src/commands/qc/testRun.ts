import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import apiClient, { MultipartPart } from '../../services/ApiClient';
import { printGate } from './pipeline';
import { ParsedReport, ReportAttachment, REPORT_FORMATS, WIRE_FORMAT, parseReport } from './testRunReport';

/**
 * 测试运行上传（N-9，想法 #194，prd-0082 FP-17 `rp-qc-test-0106`～`0118`）。
 * 一次 POST /qc/runs/import 完成「开始批次 → 上报结果 → 上传截图 → 结束（建 Bug / 门禁 / 挂到步骤）」；
 * 分步上报仍用 qc run start / report / attach / finish。挂在 `qc run` 下，同时以 `test-run` 顶层命令提供。
 */

export const TEST_TYPES = ['unit', 'api', 'e2e', 'regression'];
export const ENVIRONMENTS = ['dev', 'test', 'staging', 'prod'];

/** 报告与单张截图的上限（N-9 §3.2：报告 ≤ 20 MB；截图按任务要求 > 20 MB 跳过）。 */
export const MAX_REPORT_BYTES = 20 * 1024 * 1024;
export const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;
/** rp-qc-test-0117：单次附件 ≤ 200 MB；rp-qc-test-0107：每条结果 ≤ 20 个证据。 */
export const MAX_EVIDENCE_TOTAL_BYTES = 200 * 1024 * 1024;
export const MAX_EVIDENCE_PER_CASE = 20;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export interface UploadOptions {
  project?: string;
  product?: string;
  type?: string;
  report?: string;
  format?: string;
  screenshots?: string;
  run?: string;
  step?: string;
  task?: string;
  testRound?: string;
  env?: string;
  build?: string;
  autoBug?: boolean;
  json?: boolean;
}

export interface ValidatedUpload {
  projectId: number;
  productId?: number;
  testType: string;
  reportPath: string;
  screenshotsDir?: string;
  runId?: number;
  stepId?: number;
  taskId?: number;
  planId?: number;
  environment?: string;
  buildRef?: string;
  autoBug: boolean;
}

function positiveId(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} 需要正整数，收到 ${value}`);
  return n;
}

/** 参数校验：全部在发请求前完成。 */
export function validateUploadOptions(o: UploadOptions): ValidatedUpload {
  const projectId = positiveId(o.project, '--project');
  if (projectId === undefined) throw new Error('缺少 --project <id>');
  if (!o.type || !TEST_TYPES.includes(o.type)) throw new Error(`--type 只能是 ${TEST_TYPES.join(' / ')}${o.type ? `，收到 ${o.type}` : ''}`);
  if (o.format && !REPORT_FORMATS.includes(o.format.toLowerCase() as never)) {
    throw new Error(`--format 只能是 ${REPORT_FORMATS.join(' / ')}，收到 ${o.format}`);
  }
  if (o.env && !ENVIRONMENTS.includes(o.env)) throw new Error(`--env 只能是 ${ENVIRONMENTS.join(' / ')}，收到 ${o.env}`);
  if ((o.run === undefined) !== (o.step === undefined)) throw new Error('--run 与 --step 需同时提供（自动化运行 + 步骤）');

  if (!o.report) throw new Error('缺少 --report <file>');
  if (!fs.existsSync(o.report) || !fs.statSync(o.report).isFile()) throw new Error(`报告文件不存在: ${o.report}`);
  const size = fs.statSync(o.report).size;
  if (size > MAX_REPORT_BYTES) throw new Error(`报告文件 ${fmtBytes(size)} 超过上限 20 MB，请拆分后分批上传`);
  if (o.screenshots && (!fs.existsSync(o.screenshots) || !fs.statSync(o.screenshots).isDirectory())) {
    throw new Error(`截图目录不存在: ${o.screenshots}`);
  }

  return {
    projectId,
    productId: positiveId(o.product, '--product'),
    testType: o.type,
    reportPath: o.report,
    screenshotsDir: o.screenshots,
    runId: positiveId(o.run, '--run'),
    stepId: positiveId(o.step, '--step'),
    taskId: positiveId(o.task, '--task'),
    planId: positiveId(o.testRound, '--test-round'),
    environment: o.env,
    buildRef: o.build,
    autoBug: Boolean(o.autoBug),
  };
}

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

// ── 截图收集与匹配 ──────────────────────────────────────────────────

export interface EvidenceFile {
  absPath: string;
  /** multipart 文件名：截图目录内的相对路径，分隔符换成 "__"（保留 Playwright 结果目录名作场景前缀，且同名文件不冲突） */
  uploadName: string;
  size: number;
  contentType: string;
  /** 由 Playwright 附件路径对上的用例；对不上时由服务端按文件名前缀匹配 */
  caseName?: string;
  titlePath?: string[];
  specFile?: string;
}

export interface CollectResult {
  files: EvidenceFile[];
  warnings: string[];
  skippedNonImage: number;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const tail2 = (p: string) => p.split(/[\\/]+/).slice(-2).join('/');

/**
 * 收集截图目录下的图片（递归），按 Playwright 报告里的附件路径对到用例：
 * 先比绝对路径，报告来自另一台机器（CI）时再比「结果目录/文件名」两段后缀（唯一才算）。
 */
export function collectScreenshots(dir: string, attachments: ReportAttachment[]): CollectResult {
  const warnings: string[] = [];
  const byAbs = new Map<string, ReportAttachment>();
  const byTail = new Map<string, ReportAttachment | null>();
  for (const a of attachments) {
    byAbs.set(path.resolve(a.path), a);
    const key = tail2(a.path);
    byTail.set(key, byTail.has(key) && byTail.get(key)?.caseName !== a.caseName ? null : a);
  }

  const files: EvidenceFile[] = [];
  const perCase = new Map<string, number>();
  let total = 0;
  let skippedNonImage = 0;
  for (const abs of listFiles(path.resolve(dir))) {
    const contentType = IMAGE_TYPES[path.extname(abs).toLowerCase()];
    if (!contentType) {
      skippedNonImage++;
      continue;
    }
    const size = fs.statSync(abs).size;
    const rel = path.relative(path.resolve(dir), abs);
    if (size > MAX_SCREENSHOT_BYTES) {
      warnings.push(`跳过 ${rel}：${fmtBytes(size)} 超过单张 20 MB 上限`);
      continue;
    }
    if (total + size > MAX_EVIDENCE_TOTAL_BYTES) {
      warnings.push(`跳过 ${rel}：本次附件合计将超过 200 MB`);
      continue;
    }
    const hit = byAbs.get(abs) ?? byTail.get(tail2(abs)) ?? undefined;
    if (hit) {
      const n = perCase.get(hit.caseName) ?? 0;
      if (n >= MAX_EVIDENCE_PER_CASE) {
        warnings.push(`跳过 ${rel}：用例「${hit.caseName}」已有 ${MAX_EVIDENCE_PER_CASE} 个证据`);
        continue;
      }
      perCase.set(hit.caseName, n + 1);
    }
    total += size;
    files.push({
      absPath: abs,
      uploadName: rel.split(path.sep).join('__'),
      size,
      contentType,
      caseName: hit?.caseName,
      titlePath: hit?.titlePath,
      specFile: hit?.specFile,
    });
  }
  return { files, warnings, skippedNonImage };
}

// ── 请求体 ───────────────────────────────────────────────────────────

/** POST /qc/runs/import 的 meta（N-9 §3.2；字段名以后端 DTO 为准，见 PR 待确认）。 */
export function buildImportMeta(v: ValidatedUpload, report: ParsedReport, evidence: EvidenceFile[]): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    projectId: v.projectId,
    productId: v.productId,
    testType: v.testType,
    source: v.stepId ? 'AUTOMATION_STEP' : 'CLI',
    runId: v.runId,
    stepId: v.stepId,
    taskId: v.taskId,
    planId: v.planId,
    environment: v.environment,
    buildRef: v.buildRef,
    reportFormat: WIRE_FORMAT[report.format],
    autoBug: v.autoBug ? true : undefined,
    evidenceMap: evidence.length
      ? evidence.map((e) => ({
          file: e.uploadName,
          kind: 'screenshot',
          caseName: e.caseName,
          titlePath: e.titlePath,
          specFile: e.specFile,
        }))
      : undefined,
  };
  return JSON.parse(JSON.stringify(meta)); // 去掉 undefined
}

export function buildImportParts(v: ValidatedUpload, report: ParsedReport, evidence: EvidenceFile[]): MultipartPart[] {
  return [
    { name: 'meta', json: buildImportMeta(v, report, evidence) },
    { name: 'report', filePath: v.reportPath, contentType: report.format === 'junit' ? 'application/xml' : 'application/json' },
    ...evidence.map((e) => ({ name: 'evidence', filePath: e.absPath, fileName: e.uploadName, contentType: e.contentType })),
  ];
}

// ── 输出 ─────────────────────────────────────────────────────────────

function printUploadResult(r: any, localEvidence: number) {
  const run = r?.run ?? {};
  const s = r?.summary ?? {};
  const runLabel = run.runNo ? `${run.runNo}  (ID ${run.id})` : `ID ${run.id ?? '-'}`;
  console.log(`✓ 测试运行已上传: ${runLabel}  类型 ${run.testType ?? '-'}  来源 ${run.sourceType ?? run.source ?? '-'}`);
  console.log(`  共 ${s.total ?? 0}  通过 ${s.passed ?? 0}  失败 ${s.failed ?? 0}  跳过 ${s.skipped ?? 0}${s.blocked ? `  阻塞 ${s.blocked}` : ''}${s.flaky ? `  抖动 ${s.flaky}` : ''}`);
  console.log(`  证据 ${r?.evidenceCount ?? localEvidence} 个${r?.unmatched ? `  未匹配用例 ${r.unmatched} 条（保留外部名称）` : ''}`);
  if (r?.createdBugIds?.length) console.log(`  新建 Bug: ${r.createdBugIds.join(', ')}`);
  if (r?.reusedBugIds?.length) console.log(`  已存在的 Bug（追加失败记录）: ${r.reusedBugIds.join(', ')}`);
  if (r?.bugSkippedReason) console.log(`  ⚠ ${r.bugSkippedReason}`);
  if (r?.attachedToStep) console.log('  已挂到自动化步骤的产物');
  if (r?.note) console.log(`  ${r.note}`);
  printGate(r?.gate);
}

function printLatest(r: any) {
  const run = r.run ?? r;
  const s = r.summary ?? {
    total: run.totalCount, passed: run.passedCount, failed: run.failedCount, skipped: run.skippedCount,
  };
  console.log(`\n${run.runNo ?? `ID ${run.id}`}  ${run.testType ?? run.roundType ?? '-'}  ${run.status ?? '-'}  来源 ${run.sourceType ?? '-'}  构建 ${run.buildRef ?? '-'}`);
  console.log(`共 ${s.total ?? 0}  通过 ${s.passed ?? 0}  失败 ${s.failed ?? 0}  跳过 ${s.skipped ?? 0}`);
  const failures: any[] = r.failures ?? r.failedResults ?? [];
  if (failures.length) {
    console.log('失败用例：');
    for (const f of failures) {
      const name = f.caseNo ?? f.caseTitle ?? f.externalName ?? f.name ?? `#${f.caseId ?? f.id}`;
      console.log(`  ✗ ${name}${f.failureMessage ? `  ${String(f.failureMessage).split('\n')[0].substring(0, 80)}` : ''}`);
    }
  }
  const evidence: any[] = r.evidence ?? r.thumbnails ?? [];
  if (evidence.length) console.log(`证据：${evidence.map((e) => e.fileName ?? e.name ?? e.id).join('、')}`);
}

function fail(label: string, e: unknown): never {
  console.error(`✗ ${label}:`, e instanceof Error ? e.message : String(e));
  process.exit(1);
}

// ── 注册 ─────────────────────────────────────────────────────────────

/** 在 parent（`qc run` 或顶层 `test-run`）下注册 upload / latest。 */
export function addTestRunCommands(parent: Command) {
  parent.command('upload')
    .description('上传一份 Playwright JSON / JUnit XML 报告与截图，生成一次测试运行（失败自动建 Bug、可挂到自动化步骤）')
    .requiredOption('--project <id>', '项目 ID')
    .requiredOption('--type <type>', TEST_TYPES.join('|'))
    .requiredOption('--report <file>', '报告文件：Playwright JSON 或 JUnit XML（≤ 20 MB）')
    .option('--format <format>', `${REPORT_FORMATS.join('|')}（默认按扩展名与内容识别）`)
    .option('--screenshots <dir>', '截图目录（递归，只收 png/jpg/gif/webp，单张 > 20 MB 跳过）')
    .option('--run <runId>', '自动化运行 ID（与 --step 同时给）')
    .option('--step <stepId>', '自动化运行步骤 ID（来源记为 AUTOMATION_STEP）')
    .option('--task <id>', '关联任务 ID')
    .option('--test-round <planId>', '关联测试轮次（结果回写轮次）')
    .option('--product <id>', '产品 ID（不给时由项目推出）')
    .option('--env <env>', ENVIRONMENTS.join('|'))
    .option('--build <ref>', '提交 SHA 或版本号')
    .option('--auto-bug', '失败结果自动建 Bug（不给时按项目设置）')
    .option('--json', '输出 JSON')
    .addHelpText('after', '\n退出码：0 全部通过；2 上传成功但有失败；1 参数 / 解析 / 上传错误')
    .action(async (o: UploadOptions) => {
      let failed = 0;
      try {
        const v = validateUploadOptions(o);
        const report = parseReport(v.reportPath, fs.readFileSync(v.reportPath, 'utf-8'), o.format);
        const collected = v.screenshotsDir ? collectScreenshots(v.screenshotsDir, report.attachments) : { files: [], warnings: [], skippedNonImage: 0 };
        for (const w of collected.warnings) console.error(`⚠ ${w}`);
        if (collected.skippedNonImage) console.error(`⚠ 截图目录里 ${collected.skippedNonImage} 个非图片文件未上传（trace / 视频请用 qc run attach）`);
        if (!o.json) {
          const matched = collected.files.filter((f) => f.caseName).length;
          console.log(`报告 ${path.basename(v.reportPath)}（${report.format}）：${report.stats.total} 条，通过 ${report.stats.passed}，失败 ${report.stats.failed}，跳过 ${report.stats.skipped}；截图 ${collected.files.length} 张（按附件路径对上用例 ${matched} 张）`);
        }
        const r = await apiClient.uploadMultipart('/qc/runs/import', buildImportParts(v, report, collected.files), { timeoutMs: UPLOAD_TIMEOUT_MS });
        failed = Number(r?.summary?.failed ?? report.stats.failed) || 0;
        if (o.json) console.log(JSON.stringify(r, null, 2));
        else printUploadResult(r, collected.files.length);
      } catch (e) {
        fail('上传测试运行失败', e);
      }
      if (failed > 0) process.exit(2);
    });

  parent.command('latest')
    .description('某步骤 / 任务 / 项目的最新测试运行（统计、失败用例、证据）')
    .option('--project <id>', '项目 ID')
    .option('--task <id>', '任务 ID')
    .option('--step <stepId>', '自动化运行步骤 ID')
    .option('--json', '输出 JSON')
    .action(async (o) => {
      try {
        if (o.task && o.step) throw new Error('--task 与 --step 只能给一个');
        const params = JSON.parse(JSON.stringify({
          projectId: positiveId(o.project, '--project'),
          taskId: positiveId(o.task, '--task'),
          stepId: positiveId(o.step, '--step'),
        }));
        if (Object.keys(params).length === 0) throw new Error('至少给 --project、--task、--step 之一');
        const r = await apiClient.get('/qc/runs/latest', params);
        if (o.json) { console.log(JSON.stringify(r ?? null, null, 2)); return; }
        if (!r) { console.log('暂无测试运行'); return; }
        printLatest(r);
      } catch (e) { fail('获取最新测试运行失败', e); }
    });
}

/** 顶层 `good7ob test-run`：与 `good7ob qc run upload / latest` 同一实现（prd-0082 文档里的命令名）。 */
export function registerTestRunCommands(program: Command) {
  const testRun = program
    .command('test-run')
    .description('测试运行上传与查询（同 qc run upload / latest）');
  addTestRunCommands(testRun);
  return testRun;
}
