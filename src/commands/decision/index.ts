import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { InputError, emit, fail, guarded, parseId } from '../../utils/cliHelpers';
import {
  DECISION_ERROR_CODES, DOMAINS, REVIEWS, SOURCES, buildEditBody, buildListParams, describeTargets, parseTargets,
} from './input';
import { Decision, renderDecision, renderDecisions, renderReviewed } from './render';
import { renderUploadSummary, runUpload } from './uploadRun';

/**
 * good7ob decision：个人决策记录（prd-0127 FP-19，api-0189）。只操作本人数据（身份取自登录态 / API Key，
 * 接口不接收用户 ID）。决策原文只打印到终端，不写日志文件。
 */

const BASE = '/api/v1/me/decisions';
const run = (prefix: string, fn: () => Promise<void>) => guarded(prefix, DECISION_ERROR_CODES, fn);

const fetchDecision = (id: number): Promise<Decision> => apiClient.get(`${BASE}/${id}`);

const REVIEW_ACTIONS = [['confirm', '确认'], ['exclude', '排除'], ['restore', '撤回排除']] as const;

function registerReview(decision: Command) {
  for (const [action, verb] of REVIEW_ACTIONS) {
    decision.command(`${action} <id>`)
      .description(`${verb}决策（先读取当前 version 再提交）`)
      .option('--json', '输出 JSON')
      .action((idRaw, o) => run(`${verb}决策失败`, async () => {
        const id = parseId(idRaw, 'id');
        const current = await fetchDecision(id);
        const updated: Decision = await apiClient.post(`${BASE}/${id}/review`, { action, version: current.version });
        emit(o.json, updated, () => renderReviewed(updated, verb));
      }));
  }
}

function registerRemoval(decision: Command) {
  decision.command('delete [ids...]')
    .description('删除决策（软删，保留 1 年）：给 id（可多个）或 --batch <batchId>')
    .option('--batch <batchId>', '删除该批次上传的全部决策')
    .option('--json', '输出 JSON')
    .action((ids: string[], o) => run('删除决策失败', async () => {
      const targets = parseTargets(ids, o.batch);
      const data = await apiClient.post(`${BASE}/delete`, targets);
      emit(o.json, data, () => `✓ 已删除 ${data?.deleted ?? 0} 条（保留 1 年后由系统清除）`);
    }));

  decision.command('purge [ids...]')
    .description('永久删除决策（不可恢复，含已软删的）：给 id 或 --batch，必须带 --yes')
    .option('--batch <batchId>', '永久删除该批次上传的全部决策')
    .option('--yes', '确认永久删除（必填）')
    .option('--json', '输出 JSON')
    .action((ids: string[], o) => run('永久删除决策失败', async () => {
      const targets = parseTargets(ids, o.batch);
      if (!o.yes) {
        throw new InputError(`永久删除不可恢复：将清除 ${describeTargets(targets)}，之后同一来源也不会再被重新导入。确认请加 --yes`);
      }
      const data = await apiClient.post(`${BASE}/purge`, targets);
      emit(o.json, data, () => `✓ 已永久删除 ${data?.purged ?? 0} 条`);
    }));
}

export function registerDecisionCommands(program: Command) {
  const decision = program.command('decision').description('个人决策记录（子命令: upload list get update confirm exclude restore delete purge）');

  decision.command('upload <file>')
    .description('上传抽取脚本产出的 JSONL（先在本机脱敏，按 4 MB 分块，整次共用一个批次号）')
    .option('--dry-run', '只解析、脱敏、分块并汇总，不发任何请求')
    .option('--json', '输出 JSON')
    .action((file: string, o) => run('上传决策失败', async () => {
      const summary = await runUpload(file, Boolean(o.dryRun));
      emit(o.json, summary, () => renderUploadSummary(summary));
      if (summary.failure) fail('上传中断（已成功的块不会回滚；同一文件重传是幂等的）', summary.failure, DECISION_ERROR_CODES);
    }));

  decision.command('list')
    .description('列出决策（默认不隐藏已排除，按时间倒序）')
    .option('--source <s>', SOURCES.join(' | '))
    .option('--review <r>', REVIEWS.join(' | '))
    .option('--domain <d>', `${DOMAINS.join(' | ')} | none（未分类）`)
    .option('--from <t>', '起（含）：yyyy-MM-dd（日本时间 0 点）或毫秒')
    .option('--to <t>', '止（不含）：同上')
    .option('--page <n>', '页码，默认 1')
    .option('--page-size <n>', '每页条数，默认 20，最大 100')
    .option('--json', '输出 JSON')
    .action((o) => run('读取决策列表失败', async () => {
      const data = await apiClient.get(BASE, buildListParams(o));
      emit(o.json, data, () => renderDecisions(data));
    }));

  decision.command('get <id>')
    .description('查看决策详情')
    .option('--json', '输出 JSON')
    .action((idRaw, o) => run('读取决策失败', async () => {
      const d = await fetchDecision(parseId(idRaw, 'id'));
      emit(o.json, d, () => renderDecision(d));
    }));

  decision.command('update <id>')
    .description('修改理由与领域（只改给出的字段；--domain "" 清除领域；version 自动取当前值）')
    .option('--rationale <text>', '决策理由（≤2000 字）')
    .option('--domain <d>', `${DOMAINS.join(' | ')}；传空字符串清除`)
    .option('--json', '输出 JSON')
    .action((idRaw, o) => run('修改决策失败', async () => {
      const id = parseId(idRaw, 'id');
      const edits = buildEditBody(o);
      const current = await fetchDecision(id);
      const updated: Decision = await apiClient.put(`${BASE}/${id}`, { ...edits, version: current.version });
      emit(o.json, updated, () => renderReviewed(updated, '修改'));
    }));

  registerReview(decision);
  registerRemoval(decision);
}
