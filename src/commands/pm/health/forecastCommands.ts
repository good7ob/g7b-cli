import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { AI_REQUEST_CONFIG, emit, guarded, parseId, withTimeoutHint } from '../../../utils/cliHelpers';
import { INTEL_ERROR_CODES, releaseParams } from './costInput';
import { buildExplainBody, buildWhatIfBody, MAX_QUESTION } from './intelInput';
import { Diagnosis, Explain, renderDiagnosis, renderExplain } from './renderDiagnosis';
import { Forecast, WhatIf, renderForecast, renderWhatIf } from './renderForecast';

/**
 * C2 forecasting commands under `pm health` (backend ProductIntelligenceController, api-0090 §8, §11, §12):
 * forecast, what-if, diagnosis, explain. Result envelope: business errors are HTTP 200 + code
 * 1000/1001/1002/2000. No confirmation prompts. Every leaf declares --json but reads
 * `cmd.optsWithGlobals()` (commander hands a flag placed before the subcommand to the parent).
 */

const P = (id: number) => `/progress/products/${id}`;

const EXPLAIN_TIMEOUT_HINT = '服务端可能仍在调用模型；解读不落库、不改任何数据，可以稍后重试（10 分钟内相同事实与问题会命中缓存、不再扣费）';

export function registerForecastCommands(health: Command): void {
  health
    .command('forecast <productId>')
    .description('P50/P80 completion forecast from the weekly velocity history (shows "数据不足", never a made-up date, when history is too short)')
    .option('--release <id>', 'Release-level forecast instead of product-level')
    .option('--json', 'Output as JSON')
    .action((productId, _o, cmd: Command) =>
      guarded('获取完成预测失败', INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const f: Forecast = await apiClient.get(`${P(parseId(productId, 'productId'))}/forecast`, releaseParams(o.release));
        emit(o.json, f, () => renderForecast(f ?? {}));
      }));

  health
    .command('what-if <productId>')
    .description('Simulate a scenario against the forecast (pure calculation — nothing is saved). Flags combine; none = scenario equals baseline')
    .option('--add-scope <n>', 'Scope added (0 - 1000000000, in the product\'s workload unit)')
    .option('--remove-scope <n>', 'Open scope moved out (0 - 1000000000; capped at the remaining scope)')
    .option('--velocity-multiplier <x>', 'Multiply every weekly velocity sample (0.1 - 10)')
    .option('--extra-capacity <n>', 'Extra scope per week, e.g. more people / AI (0 - 1000000)')
    .option('--deadline <yyyy-MM-dd>', 'Target date: report whether baseline and scenario meet it')
    .option('--release <id>', 'Simulate one release only')
    .option('--json', 'Output as JSON')
    .action((productId, _o, cmd: Command) =>
      guarded('What-if 模拟失败', INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = parseId(productId, 'productId');
        const result: WhatIf = await apiClient.post(`${P(id)}/what-if`, buildWhatIfBody(o));
        emit(o.json, result, () => renderWhatIf(result ?? {}));
      }));

  health
    .command('diagnosis <productId>')
    .description('Deterministic diagnosis: findings (severity + code) and the facts behind them — module delay, scope growth, blockers, velocity')
    .option('--release <id>', 'Release-level diagnosis instead of product-level')
    .option('--json', 'Output as JSON')
    .action((productId, _o, cmd: Command) =>
      guarded('获取进度诊断失败', INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const d: Diagnosis = await apiClient.get(`${P(parseId(productId, 'productId'))}/diagnosis`, releaseParams(o.release));
        emit(o.json, d, () => renderDiagnosis(d ?? {}));
      }));

  health
    .command('explain <productId>')
    .description('AI explanation over the diagnosis facts (AI-generated, needs human review; consumes AI tokens; falls back to the findings when AI is unavailable)')
    .option('--release <id>', 'Limit to one release')
    .option('--question <text>', `Your question (max ${MAX_QUESTION} chars; default: why is the progress what it is and what next)`)
    .option('--json', 'Output as JSON')
    .action((productId, _o, cmd: Command) =>
      guarded('获取 AI 解读失败', INTEL_ERROR_CODES, async () => {
        const o = cmd.optsWithGlobals();
        const id = parseId(productId, 'productId');
        const body = buildExplainBody(o);
        const e: Explain = await apiClient.post(`${P(id)}/explain`, body, AI_REQUEST_CONFIG).catch((err: unknown) => {
          throw withTimeoutHint(err, EXPLAIN_TIMEOUT_HINT);
        });
        emit(o.json, e, () => renderExplain(e ?? {}));
      }));
}
