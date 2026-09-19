"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChangeSetItemCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const changeSetInput_1 = require("./changeSetInput");
const BASE = '/forge/change-sets';
const oneOf = (values) => values.join('|');
/** Items may change only while the change set is draft / impact_analyzed (1007 otherwise). */
function withItemFields(cmd) {
    return cmd
        .option('--type <type>', `Object type (${oneOf(changeSetInput_1.OBJECT_TYPES)})`)
        .option('--kind <kind>', `Change kind (${oneOf(changeSetInput_1.CHANGE_KINDS)})`)
        .option('--description <text>', 'What changes (max 1000 chars)')
        .option('--object-id <id>', 'Id of the object in its own table')
        .option('--object-ref <ref>', 'Path / anchor / name of the object (max 300 chars)')
        .option('--json', 'Output as JSON');
}
function registerChangeSetItemCommands(cs, codes) {
    const item = cs.command('item').description('Items (impacted objects) of a change set');
    withItemFields(item.command('add <id>'))
        .description('Add a manual item (confirmed on entry); needs --type, --kind, --description and --object-id and/or --object-ref')
        .action(async (id, o) => {
        try {
            const body = (0, changeSetInput_1.buildItemAddBody)(o);
            const created = await ApiClient_1.default.post(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/items`, body);
            (0, cliHelpers_1.emit)(o.json, created, () => `✓ 条目已添加: #${created?.id ?? '-'} ${body.objectType} ${body.changeKind}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('添加条目失败', error, codes);
        }
    });
    withItemFields(item.command('update <id> <itemId>'))
        .description('Update an item (omitted flags stay unchanged; confirmation is not touched — use item confirm)')
        .action(async (id, itemId, o) => {
        try {
            const body = (0, changeSetInput_1.buildItemUpdateBody)(o);
            const updated = await ApiClient_1.default.put(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/items/${(0, cliHelpers_1.parseId)(itemId, 'itemId')}`, body);
            (0, cliHelpers_1.emit)(o.json, updated, () => `✓ 条目已更新: #${itemId}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('更新条目失败', error, codes);
        }
    });
    item
        .command('remove <id> <itemId>')
        .description('Remove an item (soft delete)')
        .action(async (id, itemId) => {
        try {
            await ApiClient_1.default.delete(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/items/${(0, cliHelpers_1.parseId)(itemId, 'itemId')}`);
            console.log(`✓ 条目已删除: #${itemId}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('删除条目失败', error, codes);
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
            const result = await ApiClient_1.default.post(`${BASE}/${(0, cliHelpers_1.parseId)(id, 'id')}/items/${(0, cliHelpers_1.parseId)(itemId, 'itemId')}/confirm`, { confirmed });
            (0, cliHelpers_1.emit)(o.json, result, () => `✓ 条目 #${itemId} ${confirmed ? '已确认' : '已取消确认'}`);
        }
        catch (error) {
            (0, cliHelpers_1.fail)('确认条目失败', error, codes);
        }
    });
}
exports.registerChangeSetItemCommands = registerChangeSetItemCommands;
//# sourceMappingURL=changeSetItemCommands.js.map