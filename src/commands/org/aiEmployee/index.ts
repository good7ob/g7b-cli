import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { ApiDate, dash, emit, fmtDateTime, guarded, parseId, renderTable, requireOneOf } from '../../../utils/cliHelpers';
import { AI_EMPLOYEE_ERROR_CODES, KEY_ACTIONS, KeyAction, MCP_ROLES, buildProfileBody } from './input';

/**
 * AI employee key / profile / capability commands (prd-0092 FP-8, FP-9; OrgAiEmployeeController under
 * /api/v1). The raw key exists only in the issue / regenerate response: it is printed once and never stored.
 */

const base = (orgId: number, id: number) => `/api/v1/orgs/${orgId}/ai-employees/${id}`;

interface IssuedKey { rawKey?: string | null; keyPrefix?: string | null; status?: string | null; createdAt?: ApiDate }
interface Capability { code?: string | null; label?: string | null; description?: string | null; managerOnly?: boolean | null }

export function renderIssuedKey(employeeId: number, action: KeyAction, key: IssuedKey): string {
  return [
    `✓ 已${action === 'issue' ? '签发' : '重新生成'} AI 员工 #${employeeId} 的 Key（前缀 ${dash(key.keyPrefix)}，状态 ${dash(key.status)}，创建于 ${fmtDateTime(key.createdAt)}）`,
    '⚠ 完整 Key 只显示这一次，请立即保存；该员工之前的 Key 已失效。',
    '',
    `  ${dash(key.rawKey)}`,
    '',
    `在该员工的机器上执行: good7ob config set api-key ${dash(key.rawKey)}`,
  ].join('\n');
}

export function renderCapabilities(items: Capability[]): string {
  if (!items.length) return '没有能力目录。';
  const rows = [['代码', '名称', '仅 MANAGER', '说明']].concat(
    items.map((c) => [dash(c.code), dash(c.label), c.managerOnly ? '是' : '否', dash(c.description)])
  );
  return renderTable(rows, { 3: { truncate: 80 } });
}

export function registerAiEmployeeCommands(orgCommand: Command) {
  const emp = orgCommand
    .command('ai-employee')
    .description('AI employees — CLI/MCP key (issue|regenerate|disable|enable), profile (nickname, role, capabilities), capability catalogue');

  emp
    .command('key <action> <orgId> <employeeId>')
    .description(`Manage the employee's CLI/MCP key: ${KEY_ACTIONS.join('|')} (owner/admin only). issue / regenerate print the raw key once`)
    .option('--json', 'Output as JSON')
    .action((action, orgId, employeeId, o) =>
      guarded('操作 AI 员工 Key 失败', AI_EMPLOYEE_ERROR_CODES, async () => {
        const act = requireOneOf(String(action).trim().toLowerCase(), KEY_ACTIONS, 'action');
        const org = parseId(orgId, 'orgId');
        const id = parseId(employeeId, 'employeeId');
        if (act === 'issue' || act === 'regenerate') {
          const key: IssuedKey = await apiClient.post(`${base(org, id)}/key${act === 'regenerate' ? '/regenerate' : ''}`);
          emit(o.json, key, () => renderIssuedKey(id, act, key ?? {}));
          return;
        }
        const status = act === 'enable' ? 'active' : 'disabled';
        const result = await apiClient.patch(`${base(org, id)}/key/status`, { status });
        emit(o.json, result ?? { status }, () => `✓ AI 员工 #${id} 的 Key 已${act === 'enable' ? '启用' : '停用'}`);
      }));

  emp
    .command('profile <orgId> <employeeId>')
    .description('Update nickname / MCP role / capability scope (at least one option; owner/admin only)')
    .option('--nickname <name>', 'Display name')
    .option('--role <role>', `MCP role (${MCP_ROLES.join('|')})`)
    .option('--tools <a,b>', 'Capability codes, comma-separated (see `org ai-employee capabilities`); "" clears')
    .option('--products <1,2>', 'Product ids the employee may touch, comma-separated; "" = unrestricted')
    .option('--json', 'Output as JSON')
    .action((orgId, employeeId, o) =>
      guarded('更新 AI 员工档案失败', AI_EMPLOYEE_ERROR_CODES, async () => {
        const org = parseId(orgId, 'orgId');
        const id = parseId(employeeId, 'employeeId');
        const body = buildProfileBody(o);
        const result = await apiClient.patch(base(org, id), body);
        emit(o.json, result ?? body, () => `✓ AI 员工 #${id} 档案已更新: ${Object.keys(body).join(', ')}`);
      }));

  emp
    .command('capabilities <orgId>')
    .description('Capability catalogue: code, label, whether MANAGER-only')
    .option('--json', 'Output as JSON')
    .action((orgId, o) =>
      guarded('获取能力目录失败', AI_EMPLOYEE_ERROR_CODES, async () => {
        const org = parseId(orgId, 'orgId');
        const items: Capability[] = await apiClient.get(`/api/v1/orgs/${org}/ai-employees/capabilities`);
        emit(o.json, items, () => renderCapabilities(Array.isArray(items) ? items : []));
      }));
}
