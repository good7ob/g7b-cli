import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { ErrorCodeMap, emit, fail, parseId } from '../../utils/cliHelpers';
import { CHANGE_KINDS, OBJECT_TYPES, buildItemAddBody, buildItemUpdateBody } from './changeSetInput';
import { ChangeSetItem } from './changeSetRender';

const BASE = '/forge/change-sets';
const oneOf = (values: readonly string[]) => values.join('|');

/** Items may change only while the change set is draft / impact_analyzed (1007 otherwise). */
function withItemFields(cmd: Command): Command {
  return cmd
    .option('--type <type>', `Object type (${oneOf(OBJECT_TYPES)})`)
    .option('--kind <kind>', `Change kind (${oneOf(CHANGE_KINDS)})`)
    .option('--description <text>', 'What changes (max 1000 chars)')
    .option('--object-id <id>', 'Id of the object in its own table')
    .option('--object-ref <ref>', 'Path / anchor / name of the object (max 300 chars)')
    .option('--json', 'Output as JSON');
}

export function registerChangeSetItemCommands(cs: Command, codes: ErrorCodeMap): void {
  const item = cs.command('item').description('Items (impacted objects) of a change set');

  withItemFields(item.command('add <id>'))
    .description('Add a manual item (confirmed on entry); needs --type, --kind, --description and --object-id and/or --object-ref')
    .action(async (id, o) => {
      try {
        const body = buildItemAddBody(o);
        const created: ChangeSetItem = await apiClient.post(`${BASE}/${parseId(id, 'id')}/items`, body);
        emit(o.json, created, () => `✓ 条目已添加: #${created?.id ?? '-'} ${body.objectType} ${body.changeKind}`);
      } catch (error) {
        fail('添加条目失败', error, codes);
      }
    });

  withItemFields(item.command('update <id> <itemId>'))
    .description('Update an item (omitted flags stay unchanged; confirmation is not touched — use item confirm)')
    .action(async (id, itemId, o) => {
      try {
        const body = buildItemUpdateBody(o);
        const updated = await apiClient.put(`${BASE}/${parseId(id, 'id')}/items/${parseId(itemId, 'itemId')}`, body);
        emit(o.json, updated, () => `✓ 条目已更新: #${itemId}`);
      } catch (error) {
        fail('更新条目失败', error, codes);
      }
    });

  item
    .command('remove <id> <itemId>')
    .description('Remove an item (soft delete)')
    .action(async (id, itemId) => {
      try {
        await apiClient.delete(`${BASE}/${parseId(id, 'id')}/items/${parseId(itemId, 'itemId')}`);
        console.log(`✓ 条目已删除: #${itemId}`);
      } catch (error) {
        fail('删除条目失败', error, codes);
      }
    });

  item
    .command('confirm <id> <itemId>')
    .description('Confirm an item so it counts for submit / apply (--no withdraws the confirmation)')
    .option('--no', 'Unconfirm instead')
    .option('--json', 'Output as JSON')
    .action(async (id, itemId, o) => {
      try {
        const confirmed = !o.no;
        const result = await apiClient.post(`${BASE}/${parseId(id, 'id')}/items/${parseId(itemId, 'itemId')}/confirm`, { confirmed });
        emit(o.json, result, () => `✓ 条目 #${itemId} ${confirmed ? '已确认' : '已取消确认'}`);
      } catch (error) {
        fail('确认条目失败', error, codes);
      }
    });
}
