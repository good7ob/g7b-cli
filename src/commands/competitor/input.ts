/**
 * CLI-boundary validation, reference resolution and body building for `competitor` (api-0183). Limits mirror
 * CompetitorService / the DTO checks; the server stays the authority, this only refuses the obvious before a request.
 */
import apiClient from '../../services/ApiClient';
import {
  InputError, checkMaxLength, parseDate, parseId, requireOneOf, requireText, resolveProductId,
} from '../../utils/cliHelpers';

export const THREATS = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const CELL_VALUES = ['YES', 'PARTIAL', 'NO', 'UNKNOWN'] as const;
export const CREDIBILITIES = ['PRIMARY', 'SECONDARY', 'UNVERIFIED'] as const;
export const KINDS = ['OPPORTUNITY', 'GAP'] as const;
/** CONVERTED is reached only through `opportunity convert`. */
export const OPP_STATUS_FILTER = ['PENDING', 'CONVERTED', 'IGNORED'] as const;
export const OPP_STATUS_SET = ['PENDING', 'IGNORED'] as const;
export const CONVERT_MODES = ['CHECK', 'CREATE', 'LINK'] as const;
export const CAPABILITY_BATCH = 100;

export const MAX_NAME = 100;
export const MAX_POSITIONING = 200;
export const MAX_TARGET_USERS = 200;
export const MAX_PRICING = 500;
export const MAX_URL = 500;
export const MAX_NOTE = 1000;
export const MAX_CAPABILITY_NOTE = 500;
export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 2000;

export const upper = <T extends string>(raw: string, allowed: readonly T[], label: string): T =>
  requireOneOf(raw.trim().toUpperCase(), allowed, label);

/** Today's calendar day in Asia/Tokyo (the platform's day), the default `verifiedOn`. */
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** http(s) only, like the server (15103); checked here so a typo does not cost a round trip. */
export function checkUrl(raw: string, label: string): string {
  const url = raw.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) throw new InputError(`${label} 只接受 http:// 或 https:// 链接，收到: ${raw}`);
  return checkMaxLength(url, MAX_URL, label);
}

/** The empty-able fields a `--clear` list may name. */
export function parseClear(raw: string | undefined, allowed: readonly string[]): Set<string> {
  if (raw === undefined) return new Set();
  const names = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  names.forEach((n) => requireOneOf(n, allowed, '--clear'));
  return new Set(names);
}

/** A flag given together with its own `--clear` entry is a contradiction. */
export function rejectClearConflict(o: Record<string, unknown>, clear: Set<string>, pairs: Record<string, string>): void {
  for (const [field, flag] of Object.entries(pairs)) {
    if (clear.has(field) && o[flag] !== undefined) throw new InputError(`--${field} 与 --clear ${field} 不能同时使用`);
  }
}

interface Named { id: number; name: string }
const key = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** An id as given, or a name found (ignoring case and whitespace) in the rows `load` fetches; unique or refused. */
export async function resolveByIdOrName(raw: string, label: string, load: () => Promise<Named[]>): Promise<number> {
  const ref = raw.trim();
  if (/^[1-9][0-9]*$/.test(ref)) return parseId(ref, label);
  if (!ref) throw new InputError(`${label} 不能为空`);
  const hits = (await load()).filter((r) => key(r.name) === key(ref));
  if (hits.length === 1) return hits[0].id;
  throw new InputError(hits.length ? `${label} 「${ref}」匹配到多个，请改用 id` : `找不到 ${label} 「${ref}」（也可直接给数字 id）`);
}

export const competitorsPath = (productId: number) => `/products/${productId}/competitors`;
export const capabilitiesPath = (productId: number) => `/products/${productId}/competitor-capabilities`;
export const matrixPath = (productId: number) => `/products/${productId}/competitor-matrix`;
export const sourcesPath = (productId: number) => `/products/${productId}/competitor-sources`;
export const opportunitiesPath = (productId: number) => `/products/${productId}/competitor-opportunities`;

export const loadCompetitors = async (productId: number): Promise<Named[]> => (await apiClient.get(competitorsPath(productId))) ?? [];
export const loadCapabilities = async (productId: number): Promise<Named[]> => (await apiClient.get(capabilitiesPath(productId))) ?? [];

export const competitorId = (raw: string, productId: number) =>
  resolveByIdOrName(raw, '竞品', () => loadCompetitors(productId));
export const capabilityId = (raw: string, productId: number) =>
  resolveByIdOrName(raw, '能力项', () => loadCapabilities(productId));

/** `1,Acme` -> ids; each item an id or a name. */
export async function competitorIds(raw: string, productId: number): Promise<number[]> {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new InputError('--competitor 不能为空（逗号分隔的竞品 id 或名称）');
  return Array.from(new Set(await Promise.all(parts.map((p) => competitorId(p, productId)))));
}

export function productOf(o: { product?: string }): number {
  return resolveProductId(o.product);
}

// ── competitor ──

export interface CompetitorFlags {
  name?: string; positioning?: string; targetUsers?: string; pricing?: string; website?: string; threat?: string; note?: string;
}
export const CLEARABLE_COMPETITOR = ['positioning', 'target-users', 'pricing', 'website', 'note'] as const;

export interface CompetitorBody {
  name: string; positioning?: string | null; targetUsers?: string | null; pricing?: string | null;
  websiteUrl?: string | null; threatLevel?: string; note?: string | null; version?: number;
}

function validateCompetitorFlags(o: CompetitorFlags): void {
  if (o.name !== undefined) requireText(o.name, MAX_NAME, '--name');
  if (o.positioning !== undefined) checkMaxLength(o.positioning, MAX_POSITIONING, '--positioning');
  if (o.targetUsers !== undefined) checkMaxLength(o.targetUsers, MAX_TARGET_USERS, '--target-users');
  if (o.pricing !== undefined) checkMaxLength(o.pricing, MAX_PRICING, '--pricing');
  if (o.website !== undefined) checkUrl(o.website, '--website');
  if (o.threat !== undefined) upper(o.threat, THREATS, '--threat');
  if (o.note !== undefined) checkMaxLength(o.note, MAX_NOTE, '--note');
}

const trimmed = (s: string | undefined) => (s === undefined ? undefined : s.trim());

export function buildCompetitorCreate(o: CompetitorFlags): CompetitorBody {
  validateCompetitorFlags(o);
  return {
    name: requireText(o.name, MAX_NAME, '--name').trim(),
    positioning: trimmed(o.positioning), targetUsers: trimmed(o.targetUsers), pricing: trimmed(o.pricing),
    websiteUrl: trimmed(o.website), threatLevel: o.threat === undefined ? undefined : upper(o.threat, THREATS, '--threat'),
    note: trimmed(o.note),
  };
}

export function hasCompetitorChange(o: CompetitorFlags & { clear?: string }): boolean {
  return [o.name, o.positioning, o.targetUsers, o.pricing, o.website, o.threat, o.note, o.clear].some((v) => v !== undefined);
}

/** PUT replaces every editable field: start from what the server has, overlay the flags, send it with the read version. */
export function mergeCompetitorUpdate(current: Record<string, any>, o: CompetitorFlags & { clear?: string }): CompetitorBody {
  validateCompetitorFlags(o);
  const clear = parseClear(o.clear, CLEARABLE_COMPETITOR);
  rejectClearConflict(o as Record<string, unknown>, clear, {
    positioning: 'positioning', 'target-users': 'targetUsers', pricing: 'pricing', website: 'website', note: 'note',
  });
  const pick = (flag: string | undefined, name: string, cur: string | null | undefined) =>
    clear.has(name) ? null : flag !== undefined ? flag.trim() : cur ?? null;
  return {
    name: o.name !== undefined ? o.name.trim() : current.name,
    positioning: pick(o.positioning, 'positioning', current.positioning),
    targetUsers: pick(o.targetUsers, 'target-users', current.targetUsers),
    pricing: pick(o.pricing, 'pricing', current.pricing),
    websiteUrl: pick(o.website, 'website', current.websiteUrl),
    threatLevel: o.threat !== undefined ? upper(o.threat, THREATS, '--threat') : current.threatLevel,
    note: pick(o.note, 'note', current.note),
    version: current.version,
  };
}

// ── capabilities ──

export interface CapabilityItemBody { refType?: string; refId?: number; name?: string; note?: string }

interface Candidate { refType: string; refId: number; name: string; code?: string | null }

/** An FE / FP / use case given as an id or as its code (`fun-org-0001`, `UC-3`), found through the candidate search (K05). */
async function resolveCandidate(raw: string, refType: 'FE' | 'FP' | 'USE_CASE', productId: number): Promise<number> {
  const ref = raw.trim();
  if (refType === 'USE_CASE') {
    const uc = /^uc-(\d+)$/i.exec(ref);
    if (!uc && /^[1-9][0-9]*$/.test(ref)) return parseId(ref, '用例 id');
  } else if (/^[1-9][0-9]*$/.test(ref)) {
    return parseId(ref, `${refType} id`);
  }
  if (!ref) throw new InputError(`${refType} 不能为空`);
  const found: Candidate[] = (await apiClient.get(`/products/${productId}/competitor-candidates`, { type: refType, keyword: ref, limit: 50 })) ?? [];
  const hit = found.find((c) => (c.code ?? '').toLowerCase() === ref.toLowerCase());
  if (!hit) throw new InputError(`产品 ${productId} 里找不到编号为 ${ref} 的 ${refType === 'USE_CASE' ? '用例' : refType}（也可直接给数字 id）`);
  return hit.refId;
}

const splitList = (raw: string | undefined) => (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export interface CapabilityAddFlags { fe?: string; fp?: string; useCase?: string; name?: string[]; note?: string }

/** The K02 items from --fe / --fp / --use-case (ids or codes) and repeatable --name; one batch is at most 100 rows. */
export async function buildCapabilityItems(o: CapabilityAddFlags, productId: number): Promise<CapabilityItemBody[]> {
  const note = o.note === undefined ? undefined : checkMaxLength(o.note, MAX_CAPABILITY_NOTE, '--note').trim();
  const items: CapabilityItemBody[] = [];
  for (const [refType, raw] of [['FE', o.fe], ['FP', o.fp], ['USE_CASE', o.useCase]] as const) {
    for (const part of splitList(raw)) items.push({ refType, refId: await resolveCandidate(part, refType, productId), note });
  }
  for (const name of o.name ?? []) items.push({ name: requireText(name, MAX_NAME, '--name').trim(), note });
  if (!items.length) throw new InputError('至少给一个来源：--fe / --fp / --use-case（编号或 id，逗号分隔）或 --name <名称>（可重复）');
  if (items.length > CAPABILITY_BATCH) throw new InputError(`一次最多添加 ${CAPABILITY_BATCH} 项，当前 ${items.length} 项`);
  return items;
}

// ── cells and sources ──

export function buildSourceFields(o: { title?: string; url?: string; credibility?: string; verifiedOn?: string }, current?: Record<string, any>) {
  const title = o.title !== undefined ? requireText(o.title, MAX_TITLE, '--title').trim() : current?.title;
  if (!title) throw new InputError('缺少 --title（来源说明）');
  const url = o.url !== undefined ? (o.url.trim() ? checkUrl(o.url, '--url') : null) : current?.url ?? null;
  const credibility = o.credibility !== undefined ? upper(o.credibility, CREDIBILITIES, '--credibility') : current?.credibility;
  if (!credibility) throw new InputError('缺少 --credibility（PRIMARY | SECONDARY | UNVERIFIED）');
  const verifiedOn = o.verifiedOn !== undefined ? parseDate(o.verifiedOn, '--verified-on') : current?.verifiedOn ?? todayJst();
  return { title, url, credibility, verifiedOn };
}

// ── opportunities ──

export interface OpportunityFlags {
  kind?: string; title?: string; description?: string; capability?: string; competitor?: string; status?: string; clear?: string;
}
export const CLEARABLE_OPPORTUNITY = ['description', 'capability', 'competitors'] as const;

export function checkOpportunityFlags(o: OpportunityFlags): void {
  if (o.kind !== undefined) upper(o.kind, KINDS, '--kind');
  if (o.title !== undefined) requireText(o.title, MAX_TITLE, '--title');
  if (o.description !== undefined) checkMaxLength(o.description, MAX_DESCRIPTION, '--description');
  if (o.status !== undefined) upper(o.status, OPP_STATUS_SET, '--status');
}

export function hasOpportunityChange(o: OpportunityFlags): boolean {
  return Object.values(o).some((v) => v !== undefined);
}
