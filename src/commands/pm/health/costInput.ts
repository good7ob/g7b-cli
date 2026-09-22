/**
 * CLI-boundary validation for the C2 budget / cost-entry commands (backend CostSupport,
 * ProductBudgetService, CostEntryService — api-0090 §9). Limits mirror the backend so a bad value
 * is rejected here with a clear message instead of as a 1001 round-trip. Unlike the backend, which
 * silently rounds to cents, the CLI refuses more than 2 decimals so a typo is not stored as a different amount.
 */

import {
  ErrorCodeMap, InputError, parseDate, parseId, parseIntInRange, requireOneOf,
} from '../../../utils/cliHelpers';
import { MAX_PAGE_SIZE, buildNoteBody } from './input';

/** Business codes of every C2 endpoint (Result envelope: HTTP 200 + non-200 `code`). */
export const INTEL_ERROR_CODES: ErrorCodeMap = {
  1000: '缺少必填参数',
  1001: '参数值不合法（数值 / 日期越界、币种与该产品已有币种不一致、Release 不属于该产品、报告期不合法、问题超长等）',
  1002: '产品 / Release / 预算 / 成本条目 / 管理报告不存在（或已删除）',
  1007: '自动入账（source=auto）的成本条目只读，不能修改或删除',
  2000: '无权限：不是该产品所属组织的成员（预算与成本的写入需组织 owner/admin）',
};

export const COST_CATEGORIES = ['labor', 'cloud', 'ai_token', 'other'] as const;
export const MAX_AMOUNT = 9_999_999_999.99;
export const MAX_LABOR_RATE = 100_000;
export const MAX_TOKEN_PRICE = 100_000;
export const MIN_ENTRY_DATE = '2000-01-01';

const DAY_MS = 86_400_000;
const MONEY = /^[0-9]+(\.[0-9]{1,2})?$/;
const TOKEN_PRICE = /^[0-9]+(\.[0-9]{1,6})?$/;

/** A positive amount with at most 2 decimals, up to `max`. */
export function parseMoney(raw: string | undefined, label: string, max: number): number {
  const text = raw?.trim();
  if (text === undefined || !MONEY.test(text)) {
    throw new InputError(`${label} 必须是最多 2 位小数的正数（如 1200.50），收到: ${raw ?? '(空)'}`);
  }
  const value = Number(text);
  if (value <= 0 || value > max) {
    throw new InputError(`${label} 必须大于 0 且不超过 ${max}，收到: ${raw}`);
  }
  return value;
}

/** Money per 1,000,000 tokens: 0 (a free model) to 100000, at most 6 decimals (the backend rounds to 6; the CLI refuses more). */
export function parseTokenPrice(raw: string | undefined, label = '--token-price-per-million'): number {
  const text = raw?.trim();
  if (text === undefined || !TOKEN_PRICE.test(text) || Number(text) > MAX_TOKEN_PRICE) {
    throw new InputError(`${label} 必须是 0 到 ${MAX_TOKEN_PRICE}、最多 6 位小数的数（0 = 免费模型），收到: ${raw ?? '(空)'}`);
  }
  return Number(text);
}

/** Upper-cased 3-letter currency code. */
export function parseCurrency(raw: string | undefined, label = '--currency'): string {
  const code = raw?.trim().toUpperCase();
  if (!code || !/^[A-Z]{3}$/.test(code)) {
    throw new InputError(`${label} 必须是 3 位字母币种代码（如 CNY、USD），收到: ${raw ?? '(空)'}`);
  }
  return code;
}

/** Day the cost was incurred: a real date from 2000-01-01 up to tomorrow (UTC), as the backend allows. */
export function parseIncurredOn(raw: string | undefined, now: Date = new Date()): string {
  if (raw === undefined) throw new InputError('--date 必填（yyyy-MM-dd）');
  const date = parseDate(raw, '--date');
  const tomorrow = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
  if (date < MIN_ENTRY_DATE || date > tomorrow) {
    throw new InputError(`--date 必须在 ${MIN_ENTRY_DATE} 到 ${tomorrow}（明天，UTC）之间，收到: ${raw}`);
  }
  return date;
}

export const releaseParams = (release?: string): Record<string, number> =>
  release === undefined ? {} : { releaseId: parseId(release, '--release') };

export interface BudgetOptions {
  amount?: string; currency?: string; laborRate?: string; tokenPricePerMillion?: string; clearTokenPrice?: boolean; note?: string; release?: string;
}

export function buildBudgetBody(o: BudgetOptions) {
  const body: Record<string, unknown> = {
    amount: parseMoney(o.amount, '--amount', MAX_AMOUNT),
    currency: parseCurrency(o.currency),
    ...buildNoteBody(o.note),
    ...releaseParams(o.release),
  };
  if (o.laborRate !== undefined) body.laborRatePerHour = parseMoney(o.laborRate, '--labor-rate', MAX_LABOR_RATE);
  if (o.tokenPricePerMillion !== undefined && o.clearTokenPrice) {
    throw new InputError('--token-price-per-million 与 --clear-token-price 不能同时使用');
  }
  if (o.tokenPricePerMillion !== undefined) body.tokenPricePerMillion = parseTokenPrice(o.tokenPricePerMillion);
  return body;
}

export interface CostEntryOptions extends BudgetOptions { category?: string; date?: string }

/** POST and PUT share this body; PUT replaces the whole entry, so an omitted --release / --note clears it. */
export function buildCostEntryBody(o: CostEntryOptions, now: Date = new Date()) {
  if (o.category === undefined) throw new InputError(`--category 必填（${COST_CATEGORIES.join(' | ')}）`);
  return {
    category: requireOneOf(o.category.trim().toLowerCase(), COST_CATEGORIES, '--category'),
    amount: parseMoney(o.amount, '--amount', MAX_AMOUNT),
    currency: parseCurrency(o.currency),
    incurredOn: parseIncurredOn(o.date, now),
    ...buildNoteBody(o.note),
    ...releaseParams(o.release),
  };
}

export interface CostEntryListOptions { release?: string; category?: string; from?: string; to?: string; page?: string; pageSize?: string }

export function buildCostEntryListParams(o: CostEntryListOptions): Record<string, string | number> {
  const params: Record<string, string | number> = {
    pageNum: parseIntInRange(o.page ?? '1', '--page', 1, 1_000_000),
    pageSize: parseIntInRange(o.pageSize ?? '20', '--page-size', 1, MAX_PAGE_SIZE),
    ...releaseParams(o.release),
  };
  if (o.category !== undefined) params.category = requireOneOf(o.category.trim().toLowerCase(), COST_CATEGORIES, '--category');
  if (o.from !== undefined) params.from = parseDate(o.from, '--from');
  if (o.to !== undefined) params.to = parseDate(o.to, '--to');
  if (params.from && params.to && params.from > params.to) {
    throw new InputError(`--from (${params.from}) 不能晚于 --to (${params.to})`);
  }
  return params;
}
