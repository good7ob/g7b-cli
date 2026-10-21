/**
 * `good7ob deliverable` (成果物台账): collect the deliverables of a period into the ledger, read them grouped by
 * kind, or register one by hand. Talks to /progress/deliverables.
 */
import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { InputError, emit, guarded, requireOneOf, requireText, resolveProductId } from '../../utils/cliHelpers';
import {
  CollectResult, KINDS, Ledger, PERIODS, parseDetail, parseOccurredAt, renderCollect, renderLedger, resolvePeriod,
} from './logic';

const BASE = '/progress/deliverables';
const CODES = {
  1000: '缺少参数或产品不存在',
  1001: '参数不合法',
  2000: '无权访问该产品（需要是其组织的成员）',
};

interface PeriodFlags { product?: string; period?: string; from?: string; to?: string; json?: boolean }

const periodOptions = (c: Command): Command => c
  .option('--product <id>', '产品 ID（或环境变量 GOOD7OB_PRODUCT_ID）')
  .option('--period <p>', `快捷期间（JST）：${PERIODS.join(' | ')}；默认今天`)
  .option('--from <date>', '开始日期 yyyy-MM-dd')
  .option('--to <date>', '结束日期 yyyy-MM-dd（含），最长 366 天')
  .option('--json', '输出 JSON');

export function registerDeliverableCommands(program: Command) {
  const cmd = program
    .command('deliverable')
    .description('成果物台账：采集某期间的成果物（合并 PR、需求点、设计、计划、任务、AI 交付物）、按类型查看、手工登记');

  periodOptions(cmd.command('collect')
    .description('把期间内的成果物从来源表采集进台账（幂等，重复执行不会重复写入）'))
    .action((o: PeriodFlags) => guarded('采集失败', CODES, async () => {
      const result: CollectResult = await apiClient.post(`${BASE}/collect`, { productId: resolveProductId(o.product), ...resolvePeriod(o) }, { timeout: 120_000 });
      emit(o.json, result, () => renderCollect(result));
    }));

  periodOptions(cmd.command('list')
    .description('查看台账里期间内的成果物，按类型分组（不会采集）'))
    .option('--kind <kind>', `只看某一类：${KINDS.join(' | ')}`)
    .option('--limit <n>', '每类最多显示条数（1-1000，默认 200）')
    .action((o: PeriodFlags & { kind?: string; limit?: string }) => guarded('读取失败', CODES, async () => {
      const kind = o.kind === undefined ? undefined : requireOneOf(o.kind, KINDS, '--kind');
      const limit = o.limit === undefined ? undefined : Number(o.limit);
      if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= 1000)) throw new InputError(`--limit 必须是 1-1000 的整数，收到: ${o.limit}`);
      const ledger: Ledger = await apiClient.get(BASE, { productId: resolveProductId(o.product), ...resolvePeriod(o), limitPerKind: limit });
      const shown: Ledger = kind
        ? { ...ledger, groups: ledger.groups.filter((g) => g.kind === kind), total: ledger.groups.filter((g) => g.kind === kind).reduce((n, g) => n + g.count, 0) }
        : ledger;
      emit(o.json, shown, () => renderLedger(shown));
    }));

  cmd.command('add')
    .description('手工登记一条来源表里没有的成果物（如平台外交付的文档）；来源标记为 manual:<uuid>，执行者为当前用户')
    .option('--product <id>', '产品 ID（或环境变量 GOOD7OB_PRODUCT_ID）')
    .requiredOption('--kind <kind>', `类型：${KINDS.join(' | ')}`)
    .requiredOption('--title <text>', '标题，最长 500 个字符')
    .option('--url <url>', '链接，必须以 http:// 或 https:// 开头')
    .option('--action <action>', '动作，小写字母/数字/下划线，默认 created')
    .option('--at <time>', '发生时间 yyyy-MM-dd 或 yyyy-MM-ddTHH:mm[:ss]（JST），默认现在，不能晚于现在')
    .option('--detail <json>', '附加信息，JSON 对象，序列化后最长 4000 个字符')
    .option('--json', '输出 JSON')
    .action((o: { product?: string; kind: string; title: string; url?: string; action?: string; at?: string; detail?: string; json?: boolean }) =>
      guarded('登记失败', CODES, async () => {
        const body = {
          productId: resolveProductId(o.product),
          kind: requireOneOf(o.kind, KINDS, '--kind'),
          title: requireText(o.title, 500, '--title'),
          url: o.url,
          action: o.action,
          occurredAt: o.at === undefined ? undefined : parseOccurredAt(o.at),
          detail: o.detail === undefined ? undefined : parseDetail(o.detail),
        };
        const item = await apiClient.post(BASE, body);
        emit(o.json, item, () => `✓ 已登记成果物 #${item?.id}（${item?.kind} / ${item?.action}）：${item?.title}\n  来源 ${item?.sourceRef}`);
      }));
}
