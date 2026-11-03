/**
 * CLI-boundary validation and body building for `uc` (api-0180). Limits mirror UseCaseService / the DTOs.
 */
import apiClient from '../../services/ApiClient';
import {
  InputError, checkMaxLength, parseId, requireOneOf, requireText, resolveProductId,
} from '../../utils/cliHelpers';

export const PRIORITIES = ['P0', 'P1', 'P2'] as const;
export const CHANNELS = ['WEB', 'APP', 'CLI', 'MCP', 'API'] as const;
export const DIAGRAM_TYPES = ['SEQUENCE', 'ACTIVITY'] as const;
export const RELATION_TYPES = ['INCLUDE', 'EXTEND'] as const;
export const CLEARABLE = ['sub-module', 'note', 'release', 'milestone'] as const;

export const MAX_GOAL = 200;
export const MAX_NOTE = 2000;
export const MAX_ACTOR_NAME = 30;
export const MAX_ENTRY_REF = 200;
export const MAX_TRIGGER = 200;
export const MAX_DIAGRAM_NAME = 100;

export const upper = <T extends string>(raw: string, allowed: readonly T[], label: string): T =>
  requireOneOf(raw.trim().toUpperCase(), allowed, label);

/** `web,cli` -> ['WEB','CLI'] (validated, de-duplicated). */
export function parseChannels(raw: string | undefined, label = '--channel'): string[] {
  if (raw === undefined || !raw.trim()) throw new InputError(`${label} 不能为空（逗号分隔，可选 ${CHANNELS.join(' | ')}）`);
  return Array.from(new Set(raw.split(',').map((c) => upper(c, CHANNELS, label))));
}

export type UcRef = { kind: 'id'; id: number } | { kind: 'code'; seqNo: number };

/** `UC-12` is the product-scoped code (needs --product); a bare number is the global id. */
export function parseUcRef(raw: string | undefined): UcRef {
  const code = /^uc-(\d+)$/i.exec((raw ?? '').trim());
  if (code) return { kind: 'code', seqNo: parseId(code[1], '用例编号') };
  return { kind: 'id', id: parseId(raw, '用例（UC-n 或 id）') };
}

interface UseCasePageData { records?: Array<{ id: number; seqNo: number }>; pages?: number }

/** Resolve a use case reference to its id; a `UC-n` code is looked up in the product's list (ascending by seqNo). */
export async function resolveUseCaseId(raw: string | undefined, product?: string): Promise<number> {
  const ref = parseUcRef(raw);
  if (ref.kind === 'id') return ref.id;
  const productId = resolveProductId(product);
  for (let page = 1; ; page++) {
    const data: UseCasePageData = (await apiClient.get(`/products/${productId}/use-cases`, { pageNum: page, pageSize: 100 })) ?? {};
    const rows = data.records ?? [];
    const hit = rows.find((r) => r.seqNo === ref.seqNo);
    if (hit) return hit.id;
    if (!rows.length || rows[rows.length - 1].seqNo > ref.seqNo || page >= (data.pages ?? page)) {
      throw new InputError(`产品 ${productId} 里没有用例 UC-${ref.seqNo}`);
    }
  }
}

interface ActorRow { id: number; name: string; enabled: boolean }
const actorKey = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** An actor given as an id, or as its name (matched like the server: ignoring case and all whitespace). */
export async function resolveActorId(raw: string, productId: number): Promise<number> {
  if (/^[1-9][0-9]*$/.test(raw.trim())) return parseId(raw, '--actor');
  const actors: ActorRow[] = (await apiClient.get(`/products/${productId}/use-case-actors`)) ?? [];
  const hit = actors.find((a) => actorKey(a.name) === actorKey(raw));
  if (!hit) throw new InputError(`--actor 找不到角色「${raw}」（可用: ${actors.map((a) => a.name).join('、') || '无'}）`);
  return hit.id;
}

interface CreateFlags {
  actor?: string; goal?: string; priority?: string; channel?: string; subModule?: string; note?: string;
  release?: string; milestone?: string;
}

const optId = (raw: string | undefined, label: string) => (raw === undefined ? undefined : parseId(raw, label));
const clean = (body: Record<string, unknown>) => Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));

export function buildCreateBody(o: CreateFlags, actorId: number): Record<string, unknown> {
  return clean({
    actorId,
    goal: requireText(o.goal, MAX_GOAL, '--goal').trim(),
    priority: upper(o.priority ?? '', PRIORITIES, '--priority'),
    channels: parseChannels(o.channel),
    subModuleId: optId(o.subModule, '--sub-module'),
    note: o.note === undefined ? undefined : checkMaxLength(o.note, MAX_NOTE, '--note'),
    targetReleaseId: optId(o.release, '--release'),
    targetMilestoneId: optId(o.milestone, '--milestone'),
  });
}

interface UpdateFlags extends Omit<CreateFlags, 'channel' | 'actor'> { actor?: string; clear?: string }
interface Current {
  actorId: number; goal: string; priority: string; subModuleId?: number | null; note?: string | null;
  targetReleaseId?: number | null; targetMilestoneId?: number | null;
}

export function parseClear(raw: string | undefined): Set<string> {
  if (raw === undefined) return new Set();
  return new Set(raw.split(',').map((f) => requireOneOf(f.trim(), CLEARABLE, '--clear')));
}

/**
 * PUT /use-cases/{id} replaces every editable field (an omitted subModuleId / note / target is cleared), so the
 * body starts from the current detail and only the flags change it. `--clear` empties an optional field.
 */
/** Called before any request: an `update` with nothing to change is a typo, not a PUT. */
export function requireChanges(o: UpdateFlags): void {
  if ([o.actor, o.goal, o.priority, o.subModule, o.note, o.release, o.milestone, o.clear].every((v) => v === undefined)) {
    throw new InputError('没有要修改的字段（--goal / --priority / --actor / --sub-module / --note / --release / --milestone / --clear）');
  }
}

export function mergeUpdateBody(current: Current, o: UpdateFlags, actorId: number | undefined): Record<string, unknown> {
  const clear = parseClear(o.clear);
  const optional: Record<string, string | undefined> = { 'sub-module': o.subModule, note: o.note, release: o.release, milestone: o.milestone };
  for (const [field, value] of Object.entries(optional)) {
    if (clear.has(field) && value !== undefined) throw new InputError(`--${field} 与 --clear ${field} 不能同时使用`);
  }
  const pick = <T>(flagValue: T | undefined, field: string, old: T | null | undefined): T | undefined =>
    clear.has(field) ? undefined : flagValue !== undefined ? flagValue : old ?? undefined;
  return clean({
    actorId: actorId ?? current.actorId,
    goal: o.goal === undefined ? current.goal : requireText(o.goal, MAX_GOAL, '--goal').trim(),
    priority: o.priority === undefined ? current.priority : upper(o.priority, PRIORITIES, '--priority'),
    subModuleId: pick(optId(o.subModule, '--sub-module'), 'sub-module', current.subModuleId),
    note: pick(o.note === undefined ? undefined : checkMaxLength(o.note, MAX_NOTE, '--note'), 'note', current.note),
    targetReleaseId: pick(optId(o.release, '--release'), 'release', current.targetReleaseId),
    targetMilestoneId: pick(optId(o.milestone, '--milestone'), 'milestone', current.targetMilestoneId),
  });
}

export function buildEntryBody(o: { channel?: string; ref?: string; fp?: string }, functionPointId: number): Record<string, unknown> {
  const [channel] = parseChannels(o.channel, '--channel');
  return { channel, entryRef: requireText(o.ref, MAX_ENTRY_REF, '--ref').trim(), functionPointId };
}

export function buildRelationBody(o: { type?: string; when?: string }, targetUseCaseId: number): Record<string, unknown> {
  const type = upper(o.type ?? '', RELATION_TYPES, '--type');
  const when = o.when === undefined ? undefined : checkMaxLength(o.when.trim(), MAX_TRIGGER, '--when');
  if (type === 'EXTEND' && !when) throw new InputError('extend 关系必须用 --when 写触发条件');
  if (type === 'INCLUDE' && when) throw new InputError('include 关系不能带 --when 触发条件');
  return clean({ type, targetUseCaseId, triggerCondition: when });
}

export function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new InputError(`--limit 必须是 1-50 的整数，收到: ${raw}`);
  return n;
}
