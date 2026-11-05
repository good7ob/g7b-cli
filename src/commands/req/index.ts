import { Command } from 'commander';
import { createIdea, withIdeaFields } from '../idea';
import { SOURCES } from '../idea/input';
import apiClient from '../../services/ApiClient';
import { emit, guarded, resolveProductId } from '../../utils/cliHelpers';
import { ACTIONS, ACTOR_TYPES, ChangesFlags, GRANULARITIES, LAYERS, SOURCES as CHANGE_SOURCES, buildQuery, renderEvents, renderSummary } from './changesLogic';

const CHANGE_CODES = { 1001: '参数不合法', 2000: '无权访问该产品（需要是其组织的成员）' };

/**
 * `good7ob req add "<title>"` — title-only alias of `good7ob idea create` (prd-0088
 * rp-forge-idea-0174). The requirement backlog is gone; requirements are now
 * ideas + structured PRDs. Capture stays at one input: the product comes from
 * GOOD7OB_PRODUCT_ID and the source defaults to `pm`.
 */
export function registerReqCommands(program: Command) {
  const req = program
    .command('req')
    .description('Quick idea capture — alias of `idea create` (only the title is required)');

  withIdeaFields(req.command('add <title...>'))
    .description('Create an idea from just a title (source defaults to pm)')
    .option('--product <id>', 'Product id (defaults to GOOD7OB_PRODUCT_ID)')
    .option('-s, --source <source>', `Source (${SOURCES.join('|')})`, 'pm')
    .option('--json', 'Output as JSON')
    // Variadic so `good7ob req add 想要个导出功能` works without quoting.
    .action((titleParts: string[], o) => createIdea({ ...o, title: titleParts.join(' ') }));

  req.command('changes')
    .description('需求变化：按日 / 周 / 月看功能、功能点、规则点的新增、修改、删除（只读，AI 员工操作单独统计）；--events 看明细')
    .option('--product <id>', '产品 ID（或环境变量 GOOD7OB_PRODUCT_ID）')
    .option('--granularity <g>', `汇总粒度：${GRANULARITIES.join(' | ')}，默认 week`)
    .option('--from <date>', '开始日期 yyyy-MM-dd（含）')
    .option('--to <date>', '结束日期 yyyy-MM-dd（含）')
    .option('--actor-type <t>', `操作者类型，逗号分隔：${ACTOR_TYPES.join(' | ')}`)
    .option('--source <s>', `来源，逗号分隔：${CHANGE_SOURCES.join(' | ')}`)
    .option('--events', '列出事件明细而不是汇总（默认最近 7 天）')
    .option('--layer <l>', `（仅 --events）层级，逗号分隔：${LAYERS.join(' | ')}`)
    .option('--action <a>', `（仅 --events）动作，逗号分隔：${ACTIONS.join(' | ')}`)
    .option('--page <n>', '（仅 --events）页码，默认 1')
    .option('--size <n>', '（仅 --events）每页条数 1-100，默认 20')
    .option('--json', '输出 JSON')
    .action((o: ChangesFlags) => guarded('读取失败', CHANGE_CODES, async () => {
      const q = buildQuery(o, Intl.DateTimeFormat().resolvedOptions().timeZone);
      const base = `/forge/products/${resolveProductId(o.product)}/requirement-changes`;
      const data = await apiClient.get(q.path === 'summary' ? `${base}/summary` : base, q.params);
      emit(o.json, data, () => (q.path === 'summary' ? renderSummary(data) : renderEvents(data)));
    }));

  req.on('command:*', (operands: string[]) => {
    console.error(`✗ good7ob req ${operands[0]} 已下线：需求池已改为「想法 + PRD」，请用 good7ob idea ...（见 good7ob idea --help）`);
    process.exit(1);
  });
}
