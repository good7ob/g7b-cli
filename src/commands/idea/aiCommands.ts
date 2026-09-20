import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, fail, parseId } from '../../utils/cliHelpers';
import { AI_TIMEOUT_MS, GENERATE_ERROR_CODES, MAX_COUNT, MIN_COUNT, buildGenerateBody, withTimeoutHint } from './aiInput';
import { EstimationCorrection, GenerateResult, renderCorrection, renderGenerated } from './aiRender';
import { IDEA_ERROR_CODES } from './input';

/** A2: AI solution generation and the per-product estimation-correction factors. */
export function registerAiCommands(idea: Command): void {
  idea
    .command('generate <ideaId>')
    .description(`Ask the AI for ${MIN_COUNT}-${MAX_COUNT} candidate solutions with estimates (draft/evaluating ideas only; spends tokens / API quota; results are ESTIMATES to be confirmed by a person)`)
    .option('--count <n>', `How many solutions (${MIN_COUNT}-${MAX_COUNT}, default 3)`)
    .option('--hints <text>', 'Extra requirements for the model (max 1000 chars)')
    .option('--json', 'Output as JSON')
    .action(async (ideaId, o) => {
      try {
        const id = parseId(ideaId, 'ideaId');
        const body = buildGenerateBody(o);
        const result: GenerateResult = await apiClient
          .post(`/forge/ideas/${id}/solutions/generate`, body, { timeout: AI_TIMEOUT_MS })
          .catch((e: unknown) => {
            throw withTimeoutHint(e, `good7ob idea get ${id}`);
          });
        emit(o.json, result, () => renderGenerated(id, result));
      } catch (error) {
        fail('AI 生成方案失败', error, GENERATE_ERROR_CODES);
      }
    });

  idea
    .command('correction <productId>')
    .description('Show the estimation-correction factors (effort / cycle / cost) learned from completed effect reviews')
    .option('--json', 'Output as JSON')
    .action(async (productId, o) => {
      try {
        const result: EstimationCorrection = await apiClient.get(`/forge/products/${parseId(productId, 'productId')}/estimation-correction`);
        emit(o.json, result, () => renderCorrection(result));
      } catch (error) {
        fail('获取估算修正系数失败', error, IDEA_ERROR_CODES);
      }
    });
}
