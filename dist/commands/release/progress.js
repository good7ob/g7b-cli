"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerReleaseProgressCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const input_1 = require("../pm/health/input");
const progressRender_1 = require("./progressRender");
/**
 * Release-level progress (backend ReleaseProgressController, /progress/releases/{id}). Note the
 * different error codes from the rest of `release` (/forge/releases): these use the progress
 * module's 1000/1001/1002/1008/2000. Any org member of the release's product may use them.
 */
const guarded = (prefix, fn) => fn().catch((e) => (0, cliHelpers_1.fail)(prefix, e, input_1.PROGRESS_ERROR_CODES));
function registerReleaseProgressCommands(release) {
    release
        .command('health <releaseId>')
        .description('Release-level KPIs: scope, baseline, weighted progress, velocity and ETA (in the product\'s workload basis)')
        .option('--json', 'Output as JSON')
        .action((releaseId, o) => guarded('获取 Release 健康度失败', async () => {
        const h = await ApiClient_1.default.get(`/progress/releases/${(0, cliHelpers_1.parseId)(releaseId, 'releaseId')}/health`);
        (0, cliHelpers_1.emit)(o.json, h, () => (0, progressRender_1.renderReleaseHealth)(h ?? {}));
    }));
    release
        .command('baseline <releaseId>')
        .description('Snapshot the release\'s CURRENT scope as its new baseline (append-only; does not touch the product baseline)')
        .option('--note <text>', `Why (max ${input_1.MAX_NOTE} chars)`)
        .option('--json', 'Output as JSON')
        .action((releaseId, o) => guarded('设置 Release 基线失败', async () => {
        const rid = (0, cliHelpers_1.parseId)(releaseId, 'releaseId');
        const baseline = await ApiClient_1.default.post(`/progress/releases/${rid}/baseline`, (0, input_1.buildNoteBody)(o.note));
        (0, cliHelpers_1.emit)(o.json, baseline, () => (0, progressRender_1.renderReleaseBaseline)(baseline ?? {}));
    }));
}
exports.registerReleaseProgressCommands = registerReleaseProgressCommands;
//# sourceMappingURL=progress.js.map