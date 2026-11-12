import { ErrorCodeMap, InputError, parseDate, parseId, parseIntInRange, requireOneOf } from '../../utils/cliHelpers';

/** 个人决策记录 CLI（prd-0127 FP-19，api-0189）：参数只做边界校验，状态流转与乐观锁由后端保证。 */

export const SOURCES = ['structured', 'implicit', 'platform_question'] as const;
export const REVIEWS = ['unreviewed', 'confirmed', 'corrected', 'excluded'] as const;
export const DOMAINS = [
  'product_scope', 'architecture', 'database', 'deploy_release', 'process_workflow',
  'quality_test', 'security_compliance', 'billing_pricing', 'other',
] as const;
export const MAX_IDS = 500;
const MAX_BATCH_ID = 36;
const MAX_RATIONALE = 2000;

export const DECISION_ERROR_CODES: ErrorCodeMap = {
  1001: '参数不合法',
  1002: '决策不存在或不属于你',
  1007: '当前状态不支持该操作',
  1009: '内容已被其他窗口修改（版本冲突），请重新读取后重试',
  1017: '单次上传数据量超限，请分批上传',
  2000: '暂无权限（AI 员工身份不能使用本功能）',
};

const lower = (raw: string) => raw.trim().toLowerCase();
const drop = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** 毫秒整数，或 yyyy-MM-dd（按日本时间 0 点，与平台展示一致）。 */
export function parseTime(raw: string, label: string): number {
  const v = raw.trim();
  if (/^[0-9]{10,}$/.test(v)) return Number(v);
  return Date.parse(`${parseDate(v, label)}T00:00:00+09:00`);
}

export interface ListOpts {
  source?: string; review?: string; domain?: string; from?: string; to?: string; page?: string; pageSize?: string;
}

export function buildListParams(o: ListOpts): Record<string, string | number> {
  const from = o.from === undefined ? undefined : parseTime(o.from, '--from');
  const to = o.to === undefined ? undefined : parseTime(o.to, '--to');
  if (from !== undefined && to !== undefined && from >= to) throw new InputError('--from 必须早于 --to（区间为 [from, to)）');
  return drop({
    source: o.source ? requireOneOf(lower(o.source), SOURCES, '--source') : undefined,
    reviewStatus: o.review ? requireOneOf(lower(o.review), REVIEWS, '--review') : undefined,
    domain: o.domain ? requireOneOf(lower(o.domain), [...DOMAINS, 'none'], '--domain') : undefined,
    from,
    to,
    page: o.page === undefined ? undefined : parseIntInRange(o.page, '--page', 1, 1_000_000),
    pageSize: o.pageSize === undefined ? undefined : parseIntInRange(o.pageSize, '--page-size', 1, 100),
  });
}

export interface EditOpts { rationale?: string; domain?: string }

/** 只含给出的字段；--domain "" 表示清除。 */
export function buildEditBody(o: EditOpts): { rationale?: string; domain?: string } {
  if (o.rationale === undefined && o.domain === undefined) throw new InputError('至少给出 --rationale / --domain 之一');
  if (o.rationale !== undefined && Array.from(o.rationale).length > MAX_RATIONALE) {
    throw new InputError(`--rationale 最多 ${MAX_RATIONALE} 字，当前 ${Array.from(o.rationale).length} 字`);
  }
  return drop({
    rationale: o.rationale,
    domain: o.domain === undefined ? undefined : o.domain.trim() === '' ? '' : requireOneOf(lower(o.domain), DOMAINS, '--domain'),
  });
}

export type Targets = { ids: number[] } | { batchId: string };

/** ids 与 --batch 二选一（api-0189 §5）。 */
export function parseTargets(rawIds: string[], batch: string | undefined): Targets {
  if (rawIds.length > 0 && batch !== undefined) throw new InputError('<id...> 与 --batch 只能二选一');
  if (batch !== undefined) {
    const id = batch.trim();
    if (!id || id.length > MAX_BATCH_ID) throw new InputError(`--batch 必须是 1～${MAX_BATCH_ID} 个字符的批次号`);
    return { batchId: id };
  }
  if (rawIds.length === 0) throw new InputError('请给出决策 id（可多个），或用 --batch <batchId>');
  const ids = Array.from(new Set(rawIds.map((r) => parseId(r, 'id'))));
  if (ids.length > MAX_IDS) throw new InputError(`一次最多 ${MAX_IDS} 个 id，当前 ${ids.length} 个；整批请用 --batch`);
  return { ids };
}

export const describeTargets = (t: Targets) => ('ids' in t ? `${t.ids.length} 条（id ${t.ids.join(', ')}）` : `批次 ${t.batchId} 的全部决策`);
