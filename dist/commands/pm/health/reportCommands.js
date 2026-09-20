"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerReportCommands = void 0;
const fs = __importStar(require("fs"));
const ApiClient_1 = __importDefault(require("../../../services/ApiClient"));
const cliHelpers_1 = require("../../../utils/cliHelpers");
const costInput_1 = require("./costInput");
const intelInput_1 = require("./intelInput");
const renderReport_1 = require("./renderReport");
/**
 * C2 management reports under `pm health report` (api-0090 §13): generate (stored), list (no bodies),
 * get (Markdown + structured sections; `--out` writes the Markdown to a file). Members read and generate.
 * `--ai` adds an AI summary section on top — AI-generated, marked as such; failures degrade to the plain report.
 */
const P = (id) => `/progress/products/${id}`;
const GENERATE_TIMEOUT_HINT = '服务端可能仍在生成并保存报告，先用 `good7ob pm health report list <productId>` 核对，不要盲目重试';
function registerReportCommands(health) {
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
        .action((productId, _o, cmd) => (0, cliHelpers_1.guarded)('生成管理报告失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        const body = (0, intelInput_1.buildReportBody)(o);
        const created = await ApiClient_1.default
            .post(`${P(id)}/reports/management`, body, o.ai ? cliHelpers_1.AI_REQUEST_CONFIG : undefined)
            .catch((err) => {
            throw (0, cliHelpers_1.withTimeoutHint)(err, GENERATE_TIMEOUT_HINT);
        });
        (0, cliHelpers_1.emit)(o.json, created, () => (0, renderReport_1.renderReport)(created ?? { id: 0 }, '生成'));
    }));
    report
        .command('list <productId>')
        .description('Reports of a product, newest first (without bodies)')
        .option('--release <id>', 'Only this release')
        .option('--period <type>', 'Only week | month | custom reports')
        .option('-p, --page <num>', 'Page number', '1')
        .option('--page-size <num>', 'Items per page (1-100)', '20')
        .option('--json', 'Output as JSON')
        .action((productId, _o, cmd) => (0, cliHelpers_1.guarded)('获取管理报告列表失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(productId, 'productId');
        const page = await ApiClient_1.default.get(`${P(id)}/reports/management`, (0, intelInput_1.buildReportListParams)(o));
        (0, cliHelpers_1.emit)(o.json, page, () => (0, renderReport_1.renderReportList)(page ?? {}));
    }));
    report
        .command('get <id>')
        .description('A report with its full Markdown body (--json also carries the structured sections)')
        .option('--out <file.md>', 'Write the Markdown body to this file (overwrites) instead of printing it')
        .option('--json', 'Output as JSON')
        .action((id, _o, cmd) => (0, cliHelpers_1.guarded)('获取管理报告失败', costInput_1.INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const rid = (0, cliHelpers_1.parseId)(id, 'id');
        const out = (0, intelInput_1.resolveOutPath)(o.out);
        const r = await ApiClient_1.default.get(`/progress/reports/management/${rid}`);
        if (out) {
            if (!r?.contentMarkdown)
                throw new Error('该报告没有正文，未写入文件');
            fs.writeFileSync(out, r.contentMarkdown.endsWith('\n') ? r.contentMarkdown : `${r.contentMarkdown}\n`, 'utf-8');
        }
        (0, cliHelpers_1.emit)(o.json, r, () => (out ? `${(0, renderReport_1.renderReportMeta)(r)}\n✓ 已写入 ${out}` : (0, renderReport_1.renderReport)(r ?? { id: rid })));
    }));
}
exports.registerReportCommands = registerReportCommands;
//# sourceMappingURL=reportCommands.js.map