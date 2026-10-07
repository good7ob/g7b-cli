import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { collect, emit, guarded, parseId } from '../../utils/cliHelpers';
import {
  DEV_INFO_ERROR_CODES as CODES,
  buildEffectiveParams,
  buildGrantBody,
  buildItemBody,
  buildRevealRequest,
  buildSecurityBody,
  parseGrantee,
  resolveOwner,
} from './input';
import { ClearanceVo, EffectiveVo, ItemVo, renderClearances, renderEffective, renderItemDetail, renderItemList } from './render';

/**
 * Dev info commands (/dev-info, prd-0117 FP-5): repos, environments, accounts, databases and deploy targets mounted
 * on a task / project / product / organization. Output is always masked; plaintext of a sensitive field needs the
 * explicit `get ... --reveal <field> --item <id>` and is audited by the backend with source CLI.
 */

const BASE = '/dev-info';

const ownerOptions = (cmd: Command) =>
  cmd
    .option('--task <id>', 'Task id')
    .option('--project <id>', 'Project id')
    .option('--product <id>', 'Product id')
    .option('--org <id>', 'Organization id');

const itemOptions = (cmd: Command) =>
  cmd
    .option('--type <type>', 'REPOSITORY|ENDPOINT|SERVER|DATABASE|DEPLOYMENT|TEST_ACCOUNT|OTHER')
    .option('--env <env>', 'DEV|TEST|STAGING|PROD|NONE')
    .option('--name <name>', 'Entry name')
    .option('--description <text>', 'Description (do not put passwords here)')
    .option('--field <key=value>', 'Plain field, repeatable (e.g. host=db.local)', collect)
    .option('--secret <key=value>', 'Sensitive value, repeatable (prefer --secret-env: keeps it out of shell history)', collect)
    .option('--secret-ref <key=ref>', 'Sensitive field stored as a reference text, repeatable', collect)
    .option('--secret-env <key=ENV_NAME>', 'Sensitive value read from an environment variable, repeatable', collect)
    .option('--level <level>', 'Security level L1-L4 (default: environment floor)')
    .option('--app-id <id>', 'Link to a product application')
    .option('--cloud-app-id <id>', 'Link to an infra cloud application')
    .option('--expires <yyyy-MM-dd>', 'Expiry date')
    .option('--ack-secret-warning', 'Save although name/description looks like it holds a password')
    .option('--json', 'Output as JSON');

export function registerDevInfoCommands(program: Command) {
  const devInfo = program
    .command('dev-info')
    .description('Dev info — repos, environments, accounts, databases, deploy targets (masked by default)');

  ownerOptions(
    devInfo
      .command('get')
      .description('Layered summary of a task/project/product/org (task→project→product→org), masked; --reveal shows one sensitive field')
      .option('--type <type>', 'Filter by entry type')
      .option('--env <env>', 'Filter by environment')
      .option('--include-expired', 'Also list expired entries')
      .option('--reveal <field>', 'Show the plaintext of one sensitive field (needs --item; audited)')
      .option('--item <id>', 'Entry id for --reveal')
      .option('--json', 'Output as JSON')
  ).action(async (o) =>
    guarded('读取开发信息失败', CODES, async () => {
      if (o.reveal !== undefined || o.item !== undefined) {
        const { itemId, body } = buildRevealRequest(o);
        const revealed = await apiClient.post(`${BASE}/items/${itemId}/reveal`, body);
        emit(o.json, revealed, () => String(revealed?.value ?? ''));
        return;
      }
      const owner = resolveOwner(o);
      const vo: EffectiveVo = await apiClient.get(`${BASE}/${owner.type}/${owner.id}/effective`, buildEffectiveParams(o));
      emit(o.json, vo, () => renderEffective(vo ?? {}));
    })
  );

  ownerOptions(
    devInfo
      .command('list')
      .description("List the object's own entries (no upper layers), masked")
      .option('--json', 'Output as JSON')
  ).action(async (o) =>
    guarded('获取条目列表失败', CODES, async () => {
      const owner = resolveOwner(o);
      const items: ItemVo[] = (await apiClient.get(`${BASE}/${owner.type}/${owner.id}/items`)) ?? [];
      emit(o.json, items, () => renderItemList(items));
    })
  );

  itemOptions(ownerOptions(devInfo.command('create').description('Create an entry on a task/project/product/org'))).action(async (o) =>
    guarded('创建条目失败', CODES, async () => {
      const owner = resolveOwner(o);
      const created: ItemVo = await apiClient.post(`${BASE}/${owner.type}/${owner.id}/items`, buildItemBody(o, true));
      emit(o.json, created, () => `✓ 已创建条目 #${created?.id}\n${renderItemDetail(created ?? { id: 0 })}`);
    })
  );

  itemOptions(
    devInfo
      .command('update <id>')
      .description('Update an entry (type and level are not changed here; --field replaces all plain fields, unset secrets stay)')
      .option('--clear-expires', 'Remove the expiry date')
  ).action(async (id, o) =>
    guarded('修改条目失败', CODES, async () => {
      const itemId = parseId(id, 'id');
      const updated: ItemVo = await apiClient.put(`${BASE}/items/${itemId}`, buildItemBody(o, false));
      emit(o.json, updated, () => `✓ 已更新条目 #${itemId}\n${renderItemDetail(updated ?? { id: itemId })}`);
    })
  );

  devInfo
    .command('delete <id>')
    .description('Soft-delete an entry')
    .option('--json', 'Output as JSON')
    .action(async (id, o) =>
      guarded('删除条目失败', CODES, async () => {
        const itemId = parseId(id, 'id');
        await apiClient.delete(`${BASE}/items/${itemId}`);
        emit(o.json, { id: itemId, deleted: true }, () => `✓ 条目 #${itemId} 已删除`);
      })
    );

  devInfo
    .command('set-security <id>')
    .description('Change the security level / L4 nomination list (lowering needs owner/admin and --reason)')
    .requiredOption('--level <level>', 'L1|L2|L3|L4')
    .option('--reason <text>', 'Required when lowering the level')
    .option('--l4-grantee <USER:id|AI_EMPLOYEE:id>', 'L4 nominee, repeatable (replaces the list; org owner only)', collect)
    .option('--clear-l4-grantees', 'Empty the L4 nomination list')
    .option('--json', 'Output as JSON')
    .action(async (id, o) =>
      guarded('调整安全级别失败', CODES, async () => {
        const itemId = parseId(id, 'id');
        const updated: ItemVo = await apiClient.put(`${BASE}/items/${itemId}/security`, buildSecurityBody(o));
        emit(o.json, updated, () => `✓ 条目 #${itemId} 安全级别已设为 ${updated?.securityLevel ?? o.level.toUpperCase()}`);
      })
    );

  registerClearance(devInfo);
}

function registerClearance(devInfo: Command) {
  const clearance = devInfo
    .command('clearance')
    .description('Access clearances (L1-L3 per member / AI employee and scope; org owner/admin only)');

  clearance
    .command('list')
    .description('List clearances of an organization')
    .requiredOption('--org <id>', 'Organization id')
    .option('--grantee <USER:id|AI_EMPLOYEE:id>', 'Only this grantee')
    .option('--json', 'Output as JSON')
    .action(async (o) =>
      guarded('获取访问许可失败', CODES, async () => {
        const params: Record<string, string | number> = { orgId: parseId(o.org, '--org') };
        if (o.grantee !== undefined) {
          const g = parseGrantee(o.grantee, '--grantee');
          params.granteeType = g.type;
          params.granteeId = g.id;
        }
        const list: ClearanceVo[] = (await apiClient.get(`${BASE}/clearances`, params)) ?? [];
        emit(o.json, list, () => renderClearances(list));
      })
    );

  clearance
    .command('grant')
    .description('Grant (or change the level of) a clearance')
    .requiredOption('--org <id>', 'Organization id')
    .requiredOption('--grantee <USER:id|AI_EMPLOYEE:id>', 'Member or AI employee')
    .requiredOption('--level <level>', 'L1|L2|L3')
    .requiredOption('--scope <scope>', 'ORG|PRODUCT|PROJECT')
    .option('--scope-id <id>', 'Product / project id (not for ORG)')
    .option('--json', 'Output as JSON')
    .action(async (o) =>
      guarded('授予访问许可失败', CODES, async () => {
        const granted: ClearanceVo = await apiClient.post(`${BASE}/clearances`, buildGrantBody(o));
        emit(o.json, granted, () => `✓ 已授予许可 #${granted?.id}\n${renderClearances(granted ? [granted] : [])}`);
      })
    );

  clearance
    .command('revoke <id>')
    .description('Revoke a clearance')
    .option('--json', 'Output as JSON')
    .action(async (id, o) =>
      guarded('收回访问许可失败', CODES, async () => {
        const cid = parseId(id, 'id');
        await apiClient.delete(`${BASE}/clearances/${cid}`);
        emit(o.json, { id: cid, revoked: true }, () => `✓ 许可 #${cid} 已收回`);
      })
    );
}
