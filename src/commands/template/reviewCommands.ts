import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, guarded, parseId } from '../../utils/cliHelpers';
import { TEMPLATE_ERROR_CODES as CODES, pageParams } from './input';
import { renderReviewList, renderReviewSaved } from './renderMisc';
import { buildReviewBody } from './versionInput';

const url = (id: string) => `/templates/${parseId(id, 'id')}/reviews`;

/** `template review add|list|rm`: 1-5 star reviews (only users who installed / used the template may write one). */
export function registerReviewCommands(tpl: Command): void {
  const review = tpl.command('review').description('Template reviews (1-5 stars + comment)');

  review
    .command('add <id>')
    .description('Rate a template (a second call overwrites your review; you must have installed or used it, and not own it)')
    .requiredOption('--rating <1-5>', 'Star rating 1-5')
    .option('--comment <text>', 'Comment (max 1000 chars)')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('评价失败', CODES, async () => {
      const target = url(id);
      const saved = await apiClient.post(target, buildReviewBody(o));
      emit(o.json, saved, () => renderReviewSaved(saved, Number(id)));
    }));

  review
    .command('list <id>')
    .description('List reviews of a template, newest first')
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-50)', '20')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('获取评价失败', CODES, async () => {
      const target = url(id);
      const params = pageParams(o);
      const result = await apiClient.get(target, params);
      emit(o.json, result, () => renderReviewList(result, params.pageNum, params.pageSize));
    }));

  review
    .command('rm <id>')
    .description('Delete my review (you can review again afterwards)')
    .option('--json', 'Output as JSON')
    .action((id, o) => guarded('删除评价失败', CODES, async () => {
      const target = url(id);
      await apiClient.delete(target);
      emit(o.json, { deleted: true, id: Number(id) }, () => `✓ 已删除我对模板 #${id} 的评价`);
    }));
}
