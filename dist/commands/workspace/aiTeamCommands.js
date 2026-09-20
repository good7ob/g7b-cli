"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAiCommands = void 0;
const ApiClient_1 = __importDefault(require("../../services/ApiClient"));
const cliHelpers_1 = require("../../utils/cliHelpers");
const aiTeamInput_1 = require("./aiTeamInput");
const input_1 = require("./input");
const renderAiTeam_1 = require("./renderAiTeam");
const renderDaily_1 = require("./renderDaily");
/**
 * B2 workspace commands (api-0089 §7-§9): `ai-team` (+ `log`), `daily-report` (+ `generate`), `next-actions`.
 * All under /workspace; business errors come back as HTTP 200 + non-200 `code`. `ai-team` and
 * `daily-report` are commands with subcommands, and commander lets an ancestor consume a flag it knows
 * wherever it appears, so every action reads its options through `cmd.optsWithGlobals()`.
 */
const BASE = '/workspace';
const AI_TEAM_CODES = {
    ...input_1.WORKSPACE_ERROR_CODES,
    1001: '参数值不合法（status 未知、work-log 的 from / to 格式错或范围超过 31 天、日报日期错或晚于今天）',
    1002: '不存在（AI 员工不存在或不在你的组织里；该日期还没有日报）',
    2000: '无权限：--org 不是你所在的组织',
};
const DAILY_GET_CODES = { ...AI_TEAM_CODES, 1002: '该日期还没有 AI 日报 —— 用 good7ob workspace daily-report generate [--date] 生成' };
const GENERATE_TIMEOUT_HINT = '服务端可能仍在生成并保存日报，先用 `good7ob workspace daily-report` 核对，不要盲目重试';
function registerAiTeam(workspace) {
    const team = workspace
        .command('ai-team')
        .description('My AI employees: state (working / waiting / error / idle), current tasks, queue length and lifetime stats; subcommand: log')
        .allowExcessArguments(false)
        .option('--status <status>', `Only this state (${aiTeamInput_1.AI_TEAM_STATUSES.join('|')}; default all)`)
        .option('--org <id>', 'Only this organization (you must be an active member)')
        .option('--json', 'Output as JSON')
        .action((_o, cmd) => (0, cliHelpers_1.guarded)('获取我的 AI 团队失败', AI_TEAM_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const params = (0, aiTeamInput_1.buildAiTeamParams)(o);
        const result = await ApiClient_1.default.get(`${BASE}/my-ai-team`, params);
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderAiTeam_1.renderAiTeam)(result ?? {}, params.status));
    }));
    team
        .command('log <employeeId>')
        .description('Timeline of one AI employee, newest first: work records, state changes, agent comments, reviews (default: last 7 days; --status / --org belong to the list, not to log)')
        .option('--from <time>', 'Range start: yyyy-MM-dd or yyyy-MM-ddTHH:mm[:ss] (server local time)')
        .option('--to <time>', 'Range end: yyyy-MM-dd (whole day) or yyyy-MM-ddTHH:mm[:ss]; at most 31 days after --from')
        .option('-p, --page <num>', 'Page number', '1')
        .option('--page-size <num>', `Items per page (1-${aiTeamInput_1.MAX_LOG_PAGE_SIZE})`, '20')
        .option('--json', 'Output as JSON')
        .action((employeeId, _o, cmd) => (0, cliHelpers_1.guarded)('获取 AI 员工工作日志失败', AI_TEAM_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = (0, cliHelpers_1.parseId)(employeeId, 'employeeId');
        const log = await ApiClient_1.default.get(`${BASE}/my-ai-team/${id}/work-log`, (0, aiTeamInput_1.buildWorkLogParams)(o));
        (0, cliHelpers_1.emit)(o.json, log, () => (0, renderAiTeam_1.renderWorkLog)(log ?? {}));
    }));
}
function registerDailyReport(workspace) {
    const daily = workspace
        .command('daily-report')
        .description('The stored AI daily report of a day (default today); subcommand: generate')
        .allowExcessArguments(false)
        .option('--date <yyyy-MM-dd>', 'Day of the report (default today; never in the future)')
        .option('--json', 'Output as JSON')
        .action((_o, cmd) => (0, cliHelpers_1.guarded)('获取日报失败', DAILY_GET_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const report = await ApiClient_1.default.get(`${BASE}/daily-report`, (0, aiTeamInput_1.buildDailyReportParams)(o));
        (0, cliHelpers_1.emit)(o.json, report, () => (0, renderDaily_1.renderDailyReport)(report ?? {}));
    }));
    daily
        .command('generate')
        .description('Generate or regenerate the daily report of a day (one per day; replaces the stored one)')
        .option('--date <yyyy-MM-dd>', 'Day of the report (default today; never in the future)')
        .option('--ai', 'Add an AI narrative summary (AI-generated, needs human review; falls back to the deterministic report on any failure)')
        .option('--json', 'Output as JSON')
        .action((_o, cmd) => (0, cliHelpers_1.guarded)('生成日报失败', AI_TEAM_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const body = (0, aiTeamInput_1.buildDailyReportBody)(o);
        const report = await ApiClient_1.default
            .post(`${BASE}/daily-report`, body, o.ai ? cliHelpers_1.AI_REQUEST_CONFIG : undefined)
            .catch((err) => {
            throw (0, cliHelpers_1.withTimeoutHint)(err, GENERATE_TIMEOUT_HINT);
        });
        (0, cliHelpers_1.emit)(o.json, report, () => (0, renderDaily_1.renderDailyReport)(report ?? {}, true));
    }));
}
function registerAiCommands(workspace) {
    registerAiTeam(workspace);
    registerDailyReport(workspace);
    workspace
        .command('next-actions')
        .description('What to do first: ranked next actions with a score and the reasons (deterministic, no AI)')
        .option('-l, --limit <num>', `How many (1-${aiTeamInput_1.MAX_NEXT_ACTIONS})`, '5')
        .option('--json', 'Output as JSON')
        .action((o) => (0, cliHelpers_1.guarded)('获取下一步推荐失败', input_1.WORKSPACE_ERROR_CODES, async () => {
        const result = await ApiClient_1.default.get(`${BASE}/next-actions`, (0, aiTeamInput_1.buildNextActionsParams)(o));
        (0, cliHelpers_1.emit)(o.json, result, () => (0, renderDaily_1.renderNextActions)(result ?? {}));
    }));
}
exports.registerAiCommands = registerAiCommands;
//# sourceMappingURL=aiTeamCommands.js.map