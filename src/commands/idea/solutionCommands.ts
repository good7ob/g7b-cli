import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { collect, emit, fail, parseId } from '../../utils/cliHelpers';
import { IDEA_ERROR_CODES } from './input';
import { ESTIMATION_SOURCES, LEVELS, buildSolutionCreateBody, buildSolutionUpdateBody } from './solutionInput';

const BASE = '/forge/ideas';
const oneOf = (values: readonly string[]) => values.join('|');

function withSolutionNotes(cmd: Command): Command {
  return cmd
    .option('--description <text>', 'Description')
    .option('--cost-note <text>', 'Cost note (max 500 chars)')
    .option('--cycle-note <text>', 'Cycle / timeline note (max 500 chars)')
    .option('--effect-note <text>', 'Expected effect note (max 500 chars)');
}

/** Structured estimate flags, shared by `add` and `update`. */
function withEstimate(cmd: Command): Command {
  return cmd
    .option('--effort-frontend <days>', 'Frontend person-days (0-99999.9, 1 decimal)')
    .option('--effort-backend <days>', 'Backend person-days (0-99999.9, 1 decimal)')
    .option('--effort-ai <days>', 'AI / RAG person-days (0-99999.9, 1 decimal)')
    .option('--effort-test <days>', 'Test person-days (0-99999.9, 1 decimal)')
    .option('--effort-pm <days>', 'PM / design person-days (0-99999.9, 1 decimal)')
    .option('--cost <amount>', 'Estimated total cost (0-9999999999.99, 2 decimals)')
    .option('--cloud-cost <amount>', 'Cloud cost per month (2 decimals)')
    .option('--token-cost <amount>', 'AI token cost per month (2 decimals)')
    .option('--maintenance-cost <amount>', 'Maintenance cost per month (2 decimals)')
    .option('--cycle-weeks <weeks>', 'Estimated cycle in weeks (0-999.9, 1 decimal)')
    .option('--technical-risk <level>', `Technical risk (${oneOf(LEVELS)})`)
    .option('--product-risk <level>', `Product risk (${oneOf(LEVELS)})`)
    .option('--confidence <level>', `Estimate confidence (${oneOf(LEVELS)})`)
    .option('--estimation-source <source>', `Estimate source (${oneOf(ESTIMATION_SOURCES)}, default manual)`)
    .option('--expected-effect <text>', 'Expected effect (max 2000 chars)')
    .option('--kpi <name:current:target:unit>', 'Effect KPI, repeatable, max 20 (only name is required)', collect);
}

export function registerSolutionCommands(idea: Command): void {
  const solution = idea.command('solution').description('Candidate solutions of an idea');

  withEstimate(withSolutionNotes(solution.command('add <ideaId>')))
    .description('Add a solution with an optional structured estimate (idea must be draft or evaluating)')
    .requiredOption('--name <name>', 'Solution name (max 200 chars)')
    .option('--json', 'Output as JSON')
    .action(async (ideaId, o) => {
      try {
        const id = parseId(ideaId, 'ideaId');
        const body = buildSolutionCreateBody(o);
        const created = await apiClient.post(`${BASE}/${id}/solutions`, body);
        emit(o.json, created, () => `✓ 方案已添加: #${created?.id ?? '-'} ${body.name}`);
      } catch (error) {
        fail('添加方案失败', error, IDEA_ERROR_CODES);
      }
    });

  withEstimate(withSolutionNotes(solution.command('update <ideaId> <solutionId>')))
    .description('Update a solution (omitted flags stay unchanged; --kpi replaces the whole KPI list)')
    .option('--name <name>', 'Solution name (max 200 chars)')
    .option('--clear-kpi', 'Remove all KPIs')
    .option('--json', 'Output as JSON')
    .action(async (ideaId, solutionId, o) => {
      try {
        const id = parseId(ideaId, 'ideaId');
        const sid = parseId(solutionId, 'solutionId');
        const updated = await apiClient.put(`${BASE}/${id}/solutions/${sid}`, buildSolutionUpdateBody(o));
        emit(o.json, updated, () => `✓ 方案已更新: #${sid}`);
      } catch (error) {
        fail('更新方案失败', error, IDEA_ERROR_CODES);
      }
    });

  solution
    .command('delete <ideaId> <solutionId>')
    .description('Delete a solution')
    .action(async (ideaId, solutionId) => {
      try {
        const id = parseId(ideaId, 'ideaId');
        const sid = parseId(solutionId, 'solutionId');
        await apiClient.delete(`${BASE}/${id}/solutions/${sid}`);
        console.log(`✓ 方案已删除: #${sid}`);
      } catch (error) {
        fail('删除方案失败', error, IDEA_ERROR_CODES);
      }
    });
}
