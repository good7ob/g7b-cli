import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, guarded, parseDate, parseId, parseIntInRange, ErrorCodeMap, requireOneOf } from '../../utils/cliHelpers';
import { saveUrlTo } from '../file/download';
import { resolveOutPath } from '../file/input';
import { ObjectFileVo, fmtSize } from '../file/render';

/**
 * Export commands (prd-0131, api-0131): turn a PRD document or a product's deliverable list into md / html / pdf /
 * docx / pptx. The result is a file on the object's file list; `--out` downloads it through the same short-lived
 * signed address as `good7ob file download`, which is never printed.
 */

const FORMATS = ['md', 'html', 'pdf', 'docx', 'pptx'] as const;

const EXPORT_ERROR_CODES: ErrorCodeMap = {
  999: '未登录',
  1000: '缺少必填参数',
  1001: '参数不合法，或存储空间不足',
  1002: '对象或任务不存在，或你看不到它',
  1007: '不支持的格式 / 对象，或未完成的导出已有 3 个，或该 PRD 还没有内容',
  2000: '无权操作',
};

export interface ExportJob {
  id: number;
  objectType: string;
  objectId: number | null;
  objectTitle: string | null;
  format: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  resultFileId: number | null;
  errorMessage: string | null;
}

/** Polling pace and ceiling; a test lowers the interval instead of faking timers. */
export const waitSettings = { pollMs: 2000, limitMs: 5 * 60 * 1000 };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function renderJob(job: ExportJob): string {
  const head = `#${job.id} ${job.objectTitle ?? ''} → ${job.format}  ${job.status}`;
  if (job.status === 'done') return `${head}\n结果文件 #${job.resultFileId}（good7ob file download ${job.resultFileId} 下载）`;
  if (job.status === 'failed') return `${head}\n失败：${job.errorMessage ?? '未知原因'}`;
  return head;
}

/** Poll until the job ends or the wait limit passes; the last known state is returned either way. */
async function waitFor(job: ExportJob): Promise<ExportJob> {
  let current = job;
  const deadline = Date.now() + waitSettings.limitMs;
  while ((current.status === 'queued' || current.status === 'running') && Date.now() < deadline) {
    await sleep(waitSettings.pollMs);
    current = await apiClient.get(`/export/jobs/${current.id}`);
  }
  return current;
}

async function downloadResult(fileId: number, out: string | undefined, force: boolean): Promise<string> {
  const versions: ObjectFileVo[] = await apiClient.get(`/files/${fileId}/versions`);
  const picked = versions.find((v) => v.fileId === fileId) ?? versions[0];
  if (!picked) throw new Error('结果文件不存在');
  const dest = resolveOutPath(out, picked.fileName, force);
  const signed: { url: string } = await apiClient.get(`/files/${fileId}/download-url`);
  const bytes = await saveUrlTo(signed.url, dest);
  return `已保存 ${dest}（${fmtSize(bytes)}）`;
}

interface StartOptions {
  format: string;
  cover?: boolean;
  toc?: boolean;
  slideLevel?: string;
  wait?: boolean;
  out?: string;
  force?: boolean;
  json?: boolean;
}

async function start(body: Record<string, unknown>, o: StartOptions): Promise<void> {
  const format = requireOneOf(o.format.trim().toLowerCase(), FORMATS, '--format');
  const request: Record<string, unknown> = { ...body, format };
  if (o.cover) request.cover = true;
  if (o.toc) request.toc = true;
  if (o.slideLevel !== undefined) request.slideLevel = parseIntInRange(o.slideLevel, '--slide-level', 1, 2);
  apiClient.setDefaultHeader('X-Client-Channel', 'cli');
  let job: ExportJob = await apiClient.post('/export/jobs', request);
  // --out needs the finished file, so it implies waiting
  if (o.wait || o.out) job = await waitFor(job);
  let saved = '';
  if (job.status === 'done' && o.out !== undefined && job.resultFileId) {
    saved = await downloadResult(job.resultFileId, o.out, Boolean(o.force));
  } else if (o.out !== undefined && job.status !== 'done') {
    saved = '未下载：导出还没有完成，稍后用 good7ob export job <id> 查看';
  }
  emit(o.json, job, () => [renderJob(job), saved].filter(Boolean).join('\n'));
  if (job.status === 'failed') process.exitCode = 1;
}

export function registerExportCommands(program: Command) {
  const exp = program.command('export').description('Export a PRD document or a deliverable list (md|html|pdf|docx|pptx)');

  const common = (cmd: Command) =>
    cmd
      .requiredOption('--format <fmt>', 'md|html|pdf|docx|pptx')
      .option('--cover', 'Add a cover page')
      .option('--toc', 'Add a table of contents')
      .option('--slide-level <n>', 'pptx only: heading level that starts a slide, 1 or 2 (default 2)')
      .option('--wait', 'Wait for pdf / docx / pptx to finish (up to 5 minutes)')
      .option('--out <path>', 'Download the result to this file or directory (implies --wait)')
      .option('--force', 'Overwrite an existing file with --out')
      .option('--json', 'Output as JSON');

  common(exp.command('prd <prdId>').description('Export the current document of a PRD')).action(async (prdId: string, o: StartOptions) =>
    guarded('导出失败', EXPORT_ERROR_CODES, () => start({ objectType: 'PRD_DOCUMENT', objectId: parseId(prdId, '<prdId>') }, o))
  );

  common(
    exp
      .command('deliverables <productId>')
      .description("Export a product's deliverable list for a period")
      .option('--from <date>', 'First day, yyyy-MM-dd')
      .option('--to <date>', 'Last day, yyyy-MM-dd')
  ).action(async (productId: string, o: StartOptions & { from?: string; to?: string }) =>
    guarded('导出失败', EXPORT_ERROR_CODES, () => {
      const body: Record<string, unknown> = { objectType: 'DELIVERABLE_LIST', productId: parseId(productId, '<productId>') };
      if (o.from) body.from = parseDate(o.from, '--from');
      if (o.to) body.to = parseDate(o.to, '--to');
      return start(body, o);
    })
  );

  exp
    .command('job <jobId>')
    .description('Status of an export job')
    .option('--json', 'Output as JSON')
    .action(async (jobId: string, o) =>
      guarded('读取导出任务失败', EXPORT_ERROR_CODES, async () => {
        const job: ExportJob = await apiClient.get(`/export/jobs/${parseId(jobId, '<jobId>')}`);
        emit(o.json, job, () => renderJob(job));
      })
    );

  exp
    .command('cancel <jobId>')
    .description('Cancel an export that has not started')
    .action(async (jobId: string) =>
      guarded('取消导出失败', EXPORT_ERROR_CODES, async () => {
        await apiClient.post(`/export/jobs/${parseId(jobId, '<jobId>')}/cancel`);
        console.log('已取消');
      })
    );
}
