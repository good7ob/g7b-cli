import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { dash, emit, guarded } from '../../utils/cliHelpers';

/** GET /api/v1/me/actor (prd-0092 rp-org-ai-emp-0069): who the configured key acts as — a person or an AI employee. */

export interface Actor {
  actorType?: string | null;
  userId?: number | null;
  channel?: string | null;
  employee?: {
    id?: number | null;
    orgId?: number | null;
    nickname?: string | null;
    mcpRole?: string | null;
    capabilityScope?: { tools?: string[] | null; productIds?: number[] | null } | null;
  } | null;
}

const list = (values: unknown[] | null | undefined, empty: string) => (values?.length ? values.join(', ') : empty);

export function renderActor(a: Actor): string {
  const e = a.employee;
  const lines = [
    `身份:     ${dash(a.actorType)}${e ? '（AI 员工）' : a.actorType === 'USER' ? '（人类用户）' : ''}`,
    `用户 ID:  ${dash(a.userId)}${e ? '（签发人，数据权限沿用其组织身份）' : ''}`,
    `渠道:     ${dash(a.channel)}`,
  ];
  if (e) {
    lines.push(
      'AI 员工:',
      `  ID:     ${dash(e.id)}`,
      `  昵称:   ${dash(e.nickname)}`,
      `  组织:   ${dash(e.orgId)}`,
      `  角色:   ${dash(e.mcpRole)}`,
      `  能力:   ${list(e.capabilityScope?.tools, '（无）')}`,
      `  产品:   ${list(e.capabilityScope?.productIds, '不限')}`
    );
  }
  return lines.join('\n');
}

export function registerWhoamiCommands(program: Command) {
  program
    .command('whoami')
    .description('Who the configured API key acts as: a user, or an AI employee (id, nickname, org, role, capabilities)')
    .option('--json', 'Output as JSON')
    .action((o) =>
      guarded('获取当前身份失败', {}, async () => {
        const actor: Actor = await apiClient.get('/api/v1/me/actor');
        emit(o.json, actor, () => renderActor(actor ?? {}));
      }));
}
