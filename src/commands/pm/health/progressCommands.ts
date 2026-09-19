import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { emit, fail, parseId } from '../../../utils/cliHelpers';
import {
  PROGRESS_ERROR_CODES, buildAnnotateBody, buildBurnupParams, buildConfigBody, buildScopeChangeBody,
  buildScopeChangesParams, rebuildUrl,
} from './input';
import {
  Burnup, ProgressConfig, RebuildResult, ScopeChange, ScopeChangePage, renderBurnup, renderConfig, renderRebuild,
  renderScopeChange, renderScopeChanges,
} from './renderProgress';

/**
 * C1 progress commands under `pm health` (backend ProductMetricsController). These endpoints
 * use the Result envelope: business errors are HTTP 200 + code 1000/1001/1002/2000, unlike the
 * older /health endpoints (40480 / 40380 / 40080). No confirmation prompts anywhere.
 *
 * Every leaf declares --json but reads `cmd.optsWithGlobals()`: commander hands a flag placed
 * before the subcommand to the parent, and the merged options cover both placements.
 */

const P = (id: number) => `/progress/products/${id}`;

/** Runs an action, mapping any failure (input or API) to a readable exit-1 message. */
const guarded = (prefix: string, fn: () => Promise<void>) => fn().catch((e) => fail(prefix, e, PROGRESS_ERROR_CODES));

function registerConfig(health: Command): void {
  const config = health
    .command('config')
    .description('Progress config: workload basis + status completion (subcommands: get, set)');

  config
    .command('get <productId>')
    .description('Show the workload basis and status-completion mapping (defaults if never configured)')
    .option('--json', 'Output as JSON')
    .action((productId, _o, cmd: Command) =>
      guarded('获取进度配置失败', async () => {
        const c: ProgressConfig = await apiClient.get(`${P(parseId(productId, 'productId'))}/config`);
        emit(cmd.optsWithGlobals().json, c, () => renderConfig(c ?? {}));
      }));

  config
    .command('set <productId>')
    .description('Replace the config (org owner/admin). Omitting --status-completion clears existing overrides')
    .requiredOption('--basis <basis>', 'Workload basis: ESTIMATED_HOURS | STORY_POINT | WEIGHT')
    .option('--status-completion <pairs>', 'Completion % per status, e.g. in_progress=30,blocked=50 (0-100; not completed/cancelled)')
    .option('--json', 'Output as JSON')
    .action((productId, _o, cmd: Command) =>
      guarded('保存进度配置失败', async () => {
        const o = cmd.optsWithGlobals();
        const id = parseId(productId, 'productId');
        const saved: ProgressConfig = await apiClient.put(`${P(id)}/config`, buildConfigBody(o));
        emit(o.json, saved, () => renderConfig(saved ?? {}, true));
      }));
}

function registerScopeChanges(health: Command): void {
  health
    .command('scope-changes <productId>')
    .description('Scope change history, newest first (auto entries from daily snapshots + manual ones)')
    .option('--release <id>', 'Only this release')
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-100)', '20')
    .option('--json', 'Output as JSON')
    .action((productId, _o, cmd: Command) =>
      guarded('获取范围变更失败', async () => {
        const o = cmd.optsWithGlobals();
        const id = parseId(productId, 'productId');
        const page: ScopeChangePage = await apiClient.get(`${P(id)}/scope-changes`, buildScopeChangesParams(o));
        emit(o.json, page, () => renderScopeChanges(page ?? {}));
      }));

  const change = health.command('scope-change').description('Record / annotate a scope change (subcommands: add, annotate)');

  change
    .command('add <productId>')
    .description('Record a scope change by hand (any org member)')
    .requiredOption('--delta <n>', 'Signed scope change in the product\'s basis unit, non-zero (e.g. 30 or -12.5)')
    .requiredOption('--reason <text>', 'Why (max 500 chars)')
    .option('--release <id>', 'Attribute it to a release of this product')
    .option('--json', 'Output as JSON')
    .action((productId, _o, cmd: Command) =>
      guarded('记录范围变更失败', async () => {
        const o = cmd.optsWithGlobals();
        const id = parseId(productId, 'productId');
        const created: ScopeChange = await apiClient.post(`${P(id)}/scope-changes`, buildScopeChangeBody(o));
        emit(o.json, created, () => renderScopeChange(created ?? { id: 0 }, '记录'));
      }));

  change
    .command('annotate <id>')
    .description('Set / replace the reason of any scope change entry, auto ones included (any org member)')
    .requiredOption('--reason <text>', 'Reason (max 500 chars)')
    .option('--json', 'Output as JSON')
    .action((id, _o, cmd: Command) =>
      guarded('补充范围变更原因失败', async () => {
        const o = cmd.optsWithGlobals();
        const sid = parseId(id, 'id');
        const updated: ScopeChange = await apiClient.put(`/progress/scope-changes/${sid}`, buildAnnotateBody(o.reason));
        emit(o.json, updated, () => renderScopeChange(updated ?? { id: sid }, '更新'));
      }));
}

function registerBurnupAndSnapshots(health: Command): void {
  health
    .command('burnup <productId>')
    .description('Burnup: scope vs completed per day (table + text chart). Defaults to the last 30 days')
    .option('--from <yyyy-MM-dd>', 'Start date')
    .option('--to <yyyy-MM-dd>', 'End date (default: today UTC); span at most 366 days')
    .option('--release <id>', 'Release-level burnup instead of product-level')
    .option('--json', 'Output as JSON')
    .action((productId, _o, cmd: Command) =>
      guarded('获取 Burnup 失败', async () => {
        const o = cmd.optsWithGlobals();
        const id = parseId(productId, 'productId');
        const burnup: Burnup = await apiClient.get(`${P(id)}/burnup`, buildBurnupParams(o));
        emit(o.json, burnup, () => renderBurnup(burnup ?? {}));
      }));

  const snapshots = health.command('snapshots').description('Daily progress snapshots (subcommands: rebuild)');

  snapshots
    .command('rebuild <productId>')
    .description('Backfill missing daily snapshots from task history (org owner/admin; never overwrites)')
    .option('--days <n>', 'How many days back from yesterday (1-90, default 30)')
    .option('--json', 'Output as JSON')
    .action((productId, _o, cmd: Command) =>
      guarded('重建快照失败', async () => {
        const o = cmd.optsWithGlobals();
        const result: RebuildResult = await apiClient.post(rebuildUrl(parseId(productId, 'productId'), o.days));
        emit(o.json, result, () => renderRebuild(result ?? {}));
      }));
}

export function registerProgressCommands(health: Command): void {
  registerConfig(health);
  registerScopeChanges(health);
  registerBurnupAndSnapshots(health);
}
