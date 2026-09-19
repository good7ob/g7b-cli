import * as fs from 'fs';
import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { AI_REQUEST_CONFIG, emit, guarded, parseId, withTimeoutHint } from '../../../utils/cliHelpers';
import { INTEL_ERROR_CODES } from './costInput';
import { buildReportBody, buildReportListParams, resolveOutPath } from './intelInput';
import { Report, ReportPage, renderReport, renderReportList, renderReportMeta } from './renderReport';

/**
 * C2 management reports under `pm health report` (api-0090 §13): generate (stored), list (no bodies),
 * get (Markdown + structured sections; `--out` writes the Markdown to a file). Members read and generate.
 * `--ai` adds an AI summary section on top — AI-generated, marked as such; failures degrade to the plain report.
 */

const P = (id: number) => `/progress/products/${id}`;

const GENERATE_TIMEOUT_HINT = '服务端可能仍在生成并保存报告，先用 `good7ob pm health report list <productId>` 核对，不要盲目重试';

export function registerReportCommands(health: Command): void {
  const report = health.command('report').description('Management reports (subcommands: generate, list, get)');

  report
    .command('generate <productId>')
    .description('Generate and store a management report for a week, month or custom period')
    .requiredOption('--period <type>', 'week | month | custom')
    .option('--from <yyyy-MM-dd>', 'week/month: a day inside the wanted period (default: the last complete one); custom: first day')
    .option('--to <yyyy-MM-dd>', 'custom only: last day, not after today (UTC), at most 92 days from --from inclusive')
    .option('--release <id>', 'Limit the report to one release')
    .option('--ai', 'Add an AI-written summary section (consumes AI tokens; AI-generated, needs human review)')
    .option('--json', 'Output as JSON')
    .action((productId, _o, cmd: Command) =>
      guarded('生成管理报告失败', INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = parseId(productId, 'productId');
        const body = buildReportBody(o);
        const created: Report = await apiClient
          .post(`${P(id)}/reports/management`, body, o.ai ? AI_REQUEST_CONFIG : undefined)
          .catch((err: unknown) => {
            throw withTimeoutHint(err, GENERATE_TIMEOUT_HINT);
          });
        emit(o.json, created, () => renderReport(created ?? { id: 0 }, '生成'));
      }));

  report
    .command('list <productId>')
    .description('Reports of a product, newest first (without bodies)')
    .option('--release <id>', 'Only this release')
    .option('--period <type>', 'Only week | month | custom reports')
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-100)', '20')
    .option('--json', 'Output as JSON')
    .action((productId, _o, cmd: Command) =>
      guarded('获取管理报告列表失败', INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = parseId(productId, 'productId');
        const page: ReportPage = await apiClient.get(`${P(id)}/reports/management`, buildReportListParams(o));
        emit(o.json, page, () => renderReportList(page ?? {}));
      }));

  report
    .command('get <id>')
    .description('A report with its full Markdown body (--json also carries the structured sections)')
    .option('--out <file.md>', 'Write the Markdown body to this file (overwrites) instead of printing it')
    .option('--json', 'Output as JSON')
    .action((id, _o, cmd: Command) =>
      guarded('获取管理报告失败', INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const rid = parseId(id, 'id');
        const out = resolveOutPath(o.out);
        const r: Report = await apiClient.get(`/progress/reports/management/${rid}`);
        if (out) {
          if (!r?.contentMarkdown) throw new Error('该报告没有正文，未写入文件');
          fs.writeFileSync(out, r.contentMarkdown.endsWith('\n') ? r.contentMarkdown : `${r.contentMarkdown}\n`, 'utf-8');
        }
        emit(o.json, r, () => (out ? `${renderReportMeta(r)}\n✓ 已写入 ${out}` : renderReport(r ?? { id: rid })));
      }));
}
