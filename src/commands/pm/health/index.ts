import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { ErrorCodeMap, checkMaxLength, fail, parseId } from '../../../utils/cliHelpers';
import { MAX_NOTE } from './input';
import { registerCostCommands } from './costCommands';
import { registerForecastCommands } from './forecastCommands';
import { registerProgressCommands } from './progressCommands';
import { registerReportCommands } from './reportCommands';
import { Baseline, ModuleHealth, ProductHealth, renderBaseline, renderHealth, renderModules } from './render';

/**
 * Product health dashboard (/progress/products/{id}/health, prd-0080) plus the C1 progress
 * commands (config, scope changes, burnup, snapshots — see progressCommands.ts) and the C2 progress
 * intelligence commands (forecast, what-if, diagnosis, explain — forecastCommands.ts; cost, budget,
 * cost-entry — costCommands.ts; management reports — reportCommands.ts).
 * Needs org membership on the product. Not the same thing as
 * /forge/products/{id}/progress (requirement-structuring completeness).
 * These three (health, modules, baseline) keep the old 40480/40380/40080 error codes.
 */

export const HEALTH_ERROR_CODES: ErrorCodeMap = {
  40480: '产品不存在或已删除',
  40380: '无权访问：你不是该产品所属组织的成员',
  40080: '基线备注过长（最多 500 字符）',
};

// `health` and its subcommands all declare --json; commander hands a flag placed after
// the subcommand name to the parent that also knows it, so subcommands read the merged
// options (cmd.optsWithGlobals()) instead of their own.
const output = (json: boolean | undefined, data: unknown, text: () => string) =>
  console.log(json ? JSON.stringify(data, null, 2) : text());

export function registerHealthCommands(pmCommand: Command) {
  const health = pmCommand
    .command('health <productId>')
    .description('Product health KPI (subcommands: modules, baseline, config, scope-changes, scope-change, burnup, snapshots, forecast, cost, budget, cost-entry, what-if, diagnosis, explain, report)')
    .option('--json', 'Output as JSON')
    .action(async (productId, o) => {
      try {
        const id = parseId(productId, 'productId');
        const kpi: ProductHealth = await apiClient.get(`/progress/products/${id}/health`);
        output(o.json, kpi, () => renderHealth(kpi ?? {}));
      } catch (error) {
        fail('获取产品健康度失败', error, HEALTH_ERROR_CODES);
      }
    });

  health
    .command('modules <productId>')
    .description('Per-module progress, sorted by delay days (descending)')
    .option('--json', 'Output as JSON')
    .action(async (productId, _o, cmd: Command) => {
      try {
        const id = parseId(productId, 'productId');
        const o = cmd.optsWithGlobals();
        const modules: ModuleHealth[] = await apiClient.get(`/progress/products/${id}/health/modules`);
        output(o.json, modules, () => renderModules(modules ?? []));
      } catch (error) {
        fail('获取模块健康度失败', error, HEALTH_ERROR_CODES);
      }
    });

  health
    .command('baseline <productId>')
    .description('Snapshot the CURRENT scope as the new baseline (replaces the active one)')
    .option('--note <text>', `Why (max ${MAX_NOTE} chars)`)
    .option('--json', 'Output as JSON')
    .action(async (productId, _o, cmd: Command) => {
      try {
        const id = parseId(productId, 'productId');
        const o = cmd.optsWithGlobals();
        const body = o.note === undefined ? {} : { note: checkMaxLength(o.note, MAX_NOTE, '--note') };
        const baseline: Baseline = await apiClient.post(`/progress/products/${id}/health/baseline`, body);
        output(o.json, baseline, () => renderBaseline(baseline ?? {}));
      } catch (error) {
        fail('设置基线失败', error, HEALTH_ERROR_CODES);
      }
    });

  registerProgressCommands(health);
  registerForecastCommands(health);
  registerCostCommands(health);
  registerReportCommands(health);
}
