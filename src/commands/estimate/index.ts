import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { InputError, parseId } from '../../utils/cliHelpers';

/**
 * 外部工时建议（prd-0077 FP-13）。本地 Agent 通过 CLI 提交工时建议，附依据；
 * 采纳与拒绝只能在 Web 登录会话中完成（CLI 与 MCP 渠道不允许），因此 CLI 不提供 adopt / reject。
 */

const SOURCES: Record<string, string> = { 'local-agent': 'LOCAL_AGENT', 'platform-agent': 'PLATFORM_AGENT' };
const REASON_MIN = 5;

export function toSource(raw: string | undefined): string {
  const value = SOURCES[raw ?? 'local-agent'];
  if (!value) throw new InputError(`--source 必须是 ${Object.keys(SOURCES).join(' | ')}，收到: ${raw}`);
  return value;
}

export function parseHours(raw: string | undefined): number {
  const n = Number(raw);
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(n) || n <= 0 || n > 10000) {
    throw new InputError(`--hours 必须是大于 0 且不超过 10000 的数字，收到: ${raw ?? '(空)'}`);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(raw!.trim())) throw new InputError('--hours 最多两位小数');
  return n;
}

function requireReason(reason: string | undefined): string {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length < REASON_MIN) throw new InputError(`理由至少 ${REASON_MIN} 个字，便于日后回溯`);
  return trimmed;
}

function fail(what: string, e: unknown): never {
  console.error(`✗ ${what}:`, e instanceof Error ? e.message : String(e));
  process.exit(1);
}

export function registerEstimateCommands(program: Command) {
  const cmd = program
    .command('estimate')
    .description('外部工时建议：Agent 提交功能点工时与依据；采纳只能在 Web 完成');

  cmd.command('suggest <fpId>')
    .description('为功能点提交工时建议（不改变当前工时）')
    .requiredOption('--hours <h>', '工时（小时，> 0，≤ 10000，最多两位小数）')
    .requiredOption('--basis <text>', '依据：推导过程或拆分说明')
    .requiredOption('--agent <name>', 'Agent 标识，如 claude-code@host')
    .requiredOption('--reason <text>', '提交理由（≥5 字）')
    .option('--source <source>', 'local-agent | platform-agent', 'local-agent')
    .option('--json', '输出 JSON')
    .action(async (fpId, o) => {
      try {
        const body = {
          source: toSource(o.source),
          agentName: String(o.agent).trim(),
          hours: parseHours(o.hours),
          basis: String(o.basis).trim(),
          reason: requireReason(o.reason),
        };
        const row = await apiClient.post(`/forge/function-points/${parseId(fpId, 'fpId')}/estimate-suggestions`, body);
        if (o.json) return console.log(JSON.stringify(row, null, 2));
        console.log(`✓ 已提交工时建议 #${row.id}：${row.hours}h，状态 ${row.status}（尚未生效，需在 Web 采纳）`);
      } catch (e) { fail('提交工时建议失败', e); }
    });

  cmd.command('list <fpId>')
    .description('列出功能点的全部工时建议与历史，按提交时间倒序')
    .option('--json', '输出 JSON')
    .action(async (fpId, o) => {
      try {
        const rows = (await apiClient.get(`/forge/function-points/${parseId(fpId, 'fpId')}/estimate-suggestions`)) ?? [];
        if (o.json) return console.log(JSON.stringify(rows, null, 2));
        rows.forEach((r: any) => console.log(`#${String(r.id).padEnd(6)}${String(r.status).padEnd(12)}${String(r.hours).padStart(8)}h  ${String(r.source).padEnd(15)}${String(r.agentName).padEnd(22)}${String(r.createdAt).slice(0, 16)}  ${r.reason}`));
      } catch (e) { fail('读取工时建议失败', e); }
    });
}
