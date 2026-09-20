import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { collect, emit, fail, parseId } from '../../utils/cliHelpers';
import { REVIEW_ERROR_CODES, buildReviewUpdateBody } from './reviewInput';
import { EffectReviewResult, renderReview } from './reviewRender';

/**
 * A2 effect review (forge/ideas/{id}/effect-review): after release, compare what was expected
 * (chosen solution) with what happened; completing it validates the idea and feeds the
 * estimation-correction factors. At most one review per idea.
 */

const path = (ideaId: string) => `/forge/ideas/${parseId(ideaId, 'ideaId')}/effect-review`;

export function registerReviewCommands(idea: Command): void {
  const review = idea.command('review').description('Effect review of a released idea — expected vs actual, feeds estimation correction (A2)');

  review
    .command('start <ideaId>')
    .description('Create the review draft, or refresh its snapshot / actuals (idea must be planning|developing|released)')
    .option('--json', 'Output as JSON')
    .action(async (ideaId, o) => {
      try {
        const result: EffectReviewResult = await apiClient.post(path(ideaId));
        emit(o.json, result, () => renderReview(result));
      } catch (error) {
        fail('创建 / 刷新效果复盘失败', error, REVIEW_ERROR_CODES);
      }
    });

  review
    .command('get <ideaId>')
    .description('Show the review with metrics and accuracy')
    .option('--json', 'Output as JSON')
    .action(async (ideaId, o) => {
      try {
        const result: EffectReviewResult = await apiClient.get(path(ideaId));
        emit(o.json, result, () => renderReview(result));
      } catch (error) {
        fail('获取效果复盘失败', error, REVIEW_ERROR_CODES);
      }
    });

  review
    .command('metrics <ideaId>')
    .description('Set the manual metrics (REPLACES the whole list) and/or notes of a draft review')
    .option('--metric <name:expected:actual:unit>', 'Metric, repeatable, max 20; only name is required; leave expected/actual empty for "not available" (e.g. NPS:40::pts)', collect)
    .option('--clear-metrics', 'Remove all metrics')
    .option('--notes <text>', 'Review notes (max 2000 chars)')
    .option('--json', 'Output as JSON')
    .action(async (ideaId, o) => {
      try {
        const body = buildReviewUpdateBody(o);
        const result: EffectReviewResult = await apiClient.put(path(ideaId), body);
        emit(o.json, result, () => renderReview(result));
      } catch (error) {
        fail('更新效果复盘失败', error, REVIEW_ERROR_CODES);
      }
    });

  review
    .command('complete <ideaId>')
    .description('Complete the review: freezes accuracy, moves the idea released → validated, recomputes correction factors')
    .option('--json', 'Output as JSON')
    .action(async (ideaId, o) => {
      try {
        const result: EffectReviewResult = await apiClient.post(`${path(ideaId)}/complete`);
        emit(o.json, result, () => `✓ 效果复盘已完成，Idea 已 validated\n${renderReview(result)}`);
      } catch (error) {
        fail('完成效果复盘失败', error, REVIEW_ERROR_CODES);
      }
    });
}
