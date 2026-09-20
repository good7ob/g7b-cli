import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { emit, fail, parseId } from '../../utils/cliHelpers';
import { LINK_TYPES, TRACE_ERROR_CODES, buildCreateBody, buildListParams } from './input';
import { TraceLink, describeLink, renderTraceList } from './render';

/**
 * Trace-link commands (/forge/trace-links): directed edges between product objects
 * (source -linkType-> target). The backend does not check that either object exists,
 * so the caller owns that.
 *
 * Business errors come back as HTTP 200 + non-200 `code`; ApiClient throws on those and
 * `fail` maps the trace error codes to readable messages.
 */

const BASE = '/forge/trace-links';
const TYPE_HELP = 'object type code such as IDEA, REQUIREMENT, TASK (2-32 chars A-Z/0-9/_, case-insensitive)';

export function registerTraceCommands(program: Command) {
  const trace = program
    .command('trace')
    .description('Trace links — record how ideas, requirements, tasks and tests relate');

  trace
    .command('create')
    .description('Create a trace link source → target (a duplicate is rejected with code 1006)')
    .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID)')
    .requiredOption('--source-type <type>', `Source ${TYPE_HELP}`)
    .requiredOption('--source-id <id>', 'Source object id')
    .requiredOption('--target-type <type>', `Target ${TYPE_HELP}`)
    .requiredOption('--target-id <id>', 'Target object id')
    .requiredOption('--link-type <type>', `Relation (${LINK_TYPES.join('|')})`)
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const created: TraceLink = await apiClient.post(BASE, buildCreateBody(o));
        emit(o.json, created, () => `✓ 追溯关系已创建: #${created?.id ?? '-'} ${describeLink(created ?? {} as TraceLink)}`);
      } catch (error) {
        fail('创建追溯关系失败', error, TRACE_ERROR_CODES);
      }
    });

  trace
    .command('list')
    .description('List trace links of a product, newest first (narrow by source / target / link type)')
    .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID)')
    .option('--source-type <type>', 'Filter by source type (needs --source-id)')
    .option('--source-id <id>', 'Filter by source id (needs --source-type)')
    .option('--target-type <type>', 'Filter by target type (needs --target-id)')
    .option('--target-id <id>', 'Filter by target id (needs --target-type)')
    .option('--link-type <type>', `Filter by relation (${LINK_TYPES.join('|')})`)
    .option('-p, --page <num>', 'Page number', '1')
    .option('--page-size <num>', 'Items per page (1-200)', '50')
    .option('--json', 'Output as JSON')
    .action(async (o) => {
      try {
        const params = buildListParams(o);
        const result = await apiClient.get(BASE, params);
        emit(o.json, result, () => renderTraceList(result, Number(params.pageNum), Number(params.pageSize)));
      } catch (error) {
        fail('获取追溯关系失败', error, TRACE_ERROR_CODES);
      }
    });

  trace
    .command('delete <id>')
    .description('Delete a trace link (soft delete; it can be created again)')
    .option('--json', 'Output as JSON')
    .action(async (id, o) => {
      try {
        const lid = parseId(id, 'id');
        await apiClient.delete(`${BASE}/${lid}`);
        emit(o.json, { deleted: true, id: lid }, () => `✓ 追溯关系已删除: #${lid}`);
      } catch (error) {
        fail('删除追溯关系失败', error, TRACE_ERROR_CODES);
      }
    });
}
