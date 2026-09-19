import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { AI_REQUEST_CONFIG, ErrorCodeMap, emit, guarded, parseId, withTimeoutHint } from '../../utils/cliHelpers';
import {
  AI_TEAM_STATUSES, MAX_LOG_PAGE_SIZE, MAX_NEXT_ACTIONS, buildAiTeamParams, buildDailyReportBody, buildDailyReportParams,
  buildNextActionsParams, buildWorkLogParams,
} from './aiTeamInput';
import { WORKSPACE_ERROR_CODES } from './input';
import { AiTeam, WorkLog, renderAiTeam, renderWorkLog } from './renderAiTeam';
import { DailyReport, NextActions, renderDailyReport, renderNextActions } from './renderDaily';

/**
 * B2 workspace commands (api-0089 §7-§9): `ai-team` (+ `log`), `daily-report` (+ `generate`), `next-actions`.
 * All under /workspace; business errors come back as HTTP 200 + non-200 `code`. `ai-team` and
 * `daily-report` are commands with subcommands, and commander lets an ancestor consume a flag it knows
 * wherever it appears, so every action reads its options through `cmd.optsWithGlobals()`.
 */

const BASE = '/workspace';

const AI_TEAM_CODES: ErrorCodeMap = {
  ...WORKSPACE_ERROR_CODES,
  1001: '参数值不合法（status 未知、work-log 的 from / to 格式错或范围超过 31 天、日报日期错或晚于今天）',
  1002: '不存在（AI 员工不存在或不在你的组织里；该日期还没有日报）',
  2000: '无权限：--org 不是你所在的组织',
};

const DAILY_GET_CODES: ErrorCodeMap = { ...AI_TEAM_CODES, 1002: '该日期还没有 AI 日报 —— 用 good7ob workspace daily-report generate [--date] 生成' };

const GENERATE_TIMEOUT_HINT = '服务端可能仍在生成并保存日报，先用 `good7ob workspace daily-report` 核对，不要盲目重试';

function registerAiTeam(workspace: Command): void {
  const team = workspace
    .command('ai-team')
    .description('My AI employees: state (working / waiting / error / idle), current tasks, queue length and lifetime stats; subcommand: log')
    .allowExcessArguments(false)
    .option('--status <status>', `Only this state (${AI_TEAM_STATUSES.join('|')}; default all)`)
    .option('--org <id>', 'Only this organization (you must be an active member)')
    .option('--json', 'Output as JSON')
    .action((_o, cmd: Command) =>
      guarded('获取我的 AI 团队失败', AI_TEAM_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const params = buildAiTeamParams(o);
        const result: AiTeam = await apiClient.get(`${BASE}/my-ai-team`, params);
        emit(o.json, result, () => renderAiTeam(result ?? {}, params.status as string | undefined));
      }));

  team
    .command('log <employeeId>')
    .description('Timeline of one AI employee, newest first: work records, state changes, agent comments, reviews (default: last 7 days; --status / --org belong to the list, not to log)')
    .option('--from <time>', 'Range start: yyyy-MM-dd or yyyy-MM-ddTHH:mm[:ss] (server local time)')
    .option('--to <time>', 'Range end: yyyy-MM-dd (whole day) or yyyy-MM-ddTHH:mm[:ss]; at most 31 days after --from')
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', `Items per page (1-${MAX_LOG_PAGE_SIZE})`, '20')
    .option('--json', 'Output as JSON')
    .action((employeeId, _o, cmd: Command) =>
      guarded('获取 AI 员工工作日志失败', AI_TEAM_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = parseId(employeeId, 'employeeId');
        const log: WorkLog = await apiClient.get(`${BASE}/my-ai-team/${id}/work-log`, buildWorkLogParams(o));
        emit(o.json, log, () => renderWorkLog(log ?? {}));
      }));
}

function registerDailyReport(workspace: Command): void {
  const daily = workspace
    .command('daily-report')
    .description('The stored AI daily report of a day (default today); subcommand: generate')
    .allowExcessArguments(false)
    .option('--date <yyyy-MM-dd>', 'Day of the report (default today; never in the future)')
    .option('--json', 'Output as JSON')
    .action((_o, cmd: Command) =>
      guarded('获取日报失败', DAILY_GET_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const report: DailyReport = await apiClient.get(`${BASE}/daily-report`, buildDailyReportParams(o));
        emit(o.json, report, () => renderDailyReport(report ?? {}));
      }));

  daily
    .command('generate')
    .description('Generate or regenerate the daily report of a day (one per day; replaces the stored one)')
    .option('--date <yyyy-MM-dd>', 'Day of the report (default today; never in the future)')
    .option('--ai', 'Add an AI narrative summary (AI-generated, needs human review; falls back to the deterministic report on any failure)')
    .option('--json', 'Output as JSON')
    .action((_o, cmd: Command) =>
      guarded('生成日报失败', AI_TEAM_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const body = buildDailyReportBody(o);
        const report: DailyReport = await apiClient
          .post(`${BASE}/daily-report`, body, o.ai ? AI_REQUEST_CONFIG : undefined)
          .catch((err: unknown) => {
            throw withTimeoutHint(err, GENERATE_TIMEOUT_HINT);
          });
        emit(o.json, report, () => renderDailyReport(report ?? {}, true));
      }));
}

export function registerAiCommands(workspace: Command): void {
  registerAiTeam(workspace);
  registerDailyReport(workspace);

  workspace
    .command('next-actions')
    .description('What to do first: ranked next actions with a score and the reasons (deterministic, no AI)')
    .option('-l, --limit <num>', `How many (1-${MAX_NEXT_ACTIONS})`, '5')
    .option('--json', 'Output as JSON')
    .action((o) =>
      guarded('获取下一步推荐失败', WORKSPACE_ERROR_CODES, async () => {
        const result: NextActions = await apiClient.get(`${BASE}/next-actions`, buildNextActionsParams(o));
        emit(o.json, result, () => renderNextActions(result ?? {}));
      }));
}
