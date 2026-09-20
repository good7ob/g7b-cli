"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUpgradeCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const outFile_1 = require("./outFile");
const renderCheck_1 = require("./renderCheck");
const useFlags_1 = require("./useFlags");
const useInput_1 = require("./useInput");
const url = (id) => `/templates/instances/${id}`;
/**
 * `template upgrade <instanceId>`: is there a newer published version, and what changed. Read-only: an instance and the
 * objects it created are never modified automatically. `--preview` renders the new version with the instance's saved
 * variables (overridable) without creating anything.
 */
function registerUpgradeCommands(tpl) {
    (0, useFlags_1.withOutFlags)((0, useFlags_1.withVarFlags)(tpl.command('upgrade <instanceId>')), 'the previewed result (needs --preview)')
        .description('Check whether an instance has a newer published version (diff); --preview renders that version without creating anything')
        .option('--preview', 'Render the target version with the instance\'s saved variables (override with --var / --vars-file)')
        .option('--version <x.y.z>', 'With --preview: target version (default the latest published)')
        .option('--json', 'Output as JSON')
        .action((instanceId, o) => (0, cliHelpers_1.guarded)('升级检查失败', useInput_1.USE_ERROR_CODES, async () => {
        const iid = (0, cliHelpers_1.parseId)(instanceId, 'instanceId');
        if (!o.preview) {
            const extra = ['version', 'var', 'varsFile', 'out', 'force'].filter((k) => o[k] !== undefined);
            if (extra.length)
                throw new cliHelpers_1.InputError('--version / --var / --vars-file / --out / --force 需要与 --preview 一起使用');
            const check = await ApiClient_1.default.get(`${url(iid)}/upgrade`);
            return (0, cliHelpers_1.emit)(o.json, check, () => (0, renderCheck_1.renderUpgrade)(check ?? {}));
        }
        const body = (0, useInput_1.buildPreviewBody)(o);
        const out = (0, outFile_1.checkOutTarget)(o);
        const preview = await ApiClient_1.default.post(`${url(iid)}/upgrade-preview`, body);
        (0, outFile_1.emitWithOut)(o.json, preview, (writtenTo) => (0, renderCheck_1.renderUpgradePreview)(preview ?? {}, writtenTo), {
            file: out, force: o.force, content: preview?.renderedContent, failPrefix: '预览已完成，但写入文件失败',
        });
    }));
}
exports.registerUpgradeCommands = registerUpgradeCommands;
//# sourceMappingURL=upgradeCommands.js.map