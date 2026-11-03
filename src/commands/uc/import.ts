/**
 * `good7ob uc import <files or directories...>` (prd-0180 FP-12, rp-ucase-0085～0092): turn the roles and use cases of
 * existing PlantUML use case diagrams into use cases. Preview by default; `--apply` writes. The parsing is local text
 * processing (importParse.ts); the writes are the ordinary create endpoints, so the server applies the same checks
 * (rp-ucase-0001/0003/0006) and the same permission as `uc add`. Nothing existing is ever updated (rp-ucase-0090).
 *
 * The "imported from <file>" activity of rp-ucase-0091 is the server's own USE_CASE_CREATED activity (source CLI, from
 * the X-Client-Channel header); there is no endpoint to write a custom one, so the source is recorded in the note.
 */
import * as fs from 'fs';
import * as path from 'path';
import apiClient from '../../services/ApiClient';
import {
  ErrorCodeMap, InputError, describeError, emit, parseId, renderTable, resolveProductId,
} from '../../utils/cliHelpers';
import { PRIORITIES, buildCreateBody, buildRelationBody, parseChannels, upper } from './input';
import { FilePlan, PlannedCase, PlannedInclude, Problem, actorKey, parsePuml, planDiagram } from './importParse';
import { Actor, UcListItem } from './render';

export const DUPLICATE_USE_CASE = 15001;
export const DUPLICATE_ACTOR_NAME = 15006;
export const DUPLICATE_RELATION = 15009;
const MAX_FILE_BYTES = 1024 * 1024;
const PAGE_SIZE = 100;

export interface ImportFlags {
  product?: string; priority?: string; channels?: string; submodule?: string; apply?: boolean; json?: boolean; verbose?: boolean;
}

// ── files ──

export interface Collected { files: string[]; errors: Array<{ path: string; reason: string }> }

function walk(dir: string, into: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, into); // symlinked directories are not followed
    else if (e.isFile() && /\.puml$/i.test(e.name)) into.push(full);
  }
}

/** Files and directories (recursive, `.puml` only), de-duplicated, in the order given. */
export function collectFiles(paths: string[]): Collected {
  const out: Collected = { files: [], errors: [] };
  const seen = new Set<string>();
  const add = (f: string) => { const abs = path.resolve(f); if (!seen.has(abs)) { seen.add(abs); out.files.push(abs); } };
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) { const found: string[] = []; walk(p, found); found.forEach(add); }
      else if (/\.puml$/i.test(p)) add(p);
      else out.errors.push({ path: p, reason: '不是 .puml 文件（.png 等不作为流程图导入，rp-ucase-0092）' });
    } catch (e) {
      out.errors.push({ path: p, reason: `读取失败: ${(e as Error).message}` });
    }
  }
  return out;
}

const shown = (f: string) => { const r = path.relative(process.cwd(), f); return r.startsWith('..') ? f : r; };

// ── server state ──

interface Server { actors: Map<string, number>; existing: Map<string, { id: number; code: string }> }

async function listExisting(productId: number): Promise<Map<string, { id: number; code: string }>> {
  const map = new Map<string, { id: number; code: string }>();
  for (let page = 1; ; page++) {
    const data = (await apiClient.get(`/products/${productId}/use-cases`, { pageNum: page, pageSize: PAGE_SIZE })) ?? {};
    const rows: UcListItem[] = data.records ?? [];
    // the same comparison as the server (rp-ucase-0006): role name without case / whitespace, goal trimmed and case-folded
    rows.forEach((r) => map.set(`${actorKey(String(r.actorName ?? ''))}\u0000${r.goal.trim().toLowerCase()}`, { id: r.id, code: r.code }));
    if (page >= (data.pages ?? 1) || !rows.length) return map;
  }
}

async function loadActors(productId: number): Promise<Map<string, number>> {
  const rows: Actor[] = (await apiClient.get(`/products/${productId}/use-case-actors`)) ?? [];
  return new Map(rows.map((a) => [actorKey(a.name), a.id]));
}

async function loadServer(productId: number): Promise<Server> {
  return { actors: await loadActors(productId), existing: await listExisting(productId) };
}

// ── classification ──

export type CaseStatus = 'create' | 'skip' | 'created' | 'failed';
export interface CaseResult extends PlannedCase { status: CaseStatus; reason?: string; code?: string; id?: number; newActor?: boolean }
export type RelStatus = 'create' | 'created' | 'skip' | 'failed';
export interface RelResult extends PlannedInclude { status: RelStatus; reason?: string }

/** Local pre-judgement: a role + goal that the server already has, or that an earlier node of this run has, is a skip. */
export function classify(plans: FilePlan[], server: Server | null): CaseResult[] {
  const seen = new Map<string, string>();
  const newActors = new Set<string>();
  const out: CaseResult[] = [];
  for (const c of plans.flatMap((p) => p.cases)) {
    const hit = server?.existing.get(c.key);
    if (hit) { out.push({ ...c, status: 'skip', reason: `已有 ${hit.code}`, code: hit.code, id: hit.id }); continue; }
    if (seen.has(c.key)) { out.push({ ...c, status: 'skip', reason: seen.get(c.key) }); continue; }
    seen.set(c.key, `本次导入内重复（${shown(c.file)}:${c.line} 之前已有同一角色和目标）`);
    const ak = actorKey(c.actor);
    const isNew = !!server && !server.actors.has(ak) && !newActors.has(ak);
    if (isNew) newActors.add(ak);
    out.push({ ...c, status: 'create', newActor: isNew });
  }
  return out;
}

// ── apply ──

interface Ctx { productId: number; codes: ErrorCodeMap; priority: string; channels: string[]; submodule?: string }

async function ensureActor(ctx: Ctx, server: Server, name: string): Promise<number> {
  const key = actorKey(name);
  const known = server.actors.get(key);
  if (known !== undefined) return known;
  try {
    const created: Actor = await apiClient.post(`/products/${ctx.productId}/use-case-actors`, { name });
    server.actors.set(key, created.id);
    return created.id;
  } catch (e) {
    if ((e as { code?: number })?.code !== DUPLICATE_ACTOR_NAME) throw e;
    server.actors.clear();
    (await loadActors(ctx.productId)).forEach((v, k) => server.actors.set(k, v)); // created meanwhile by someone else: reuse it
    const id = server.actors.get(key);
    if (id === undefined) throw e;
    return id;
  }
}

async function createCases(ctx: Ctx, server: Server, planned: CaseResult[]): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  for (const c of planned) {
    if (c.status !== 'create') { out.push(c); continue; }
    try {
      const actorId = await ensureActor(ctx, server, c.actor);
      const body = buildCreateBody({ goal: c.goal, priority: ctx.priority, channel: ctx.channels.join(','), subModule: ctx.submodule, note: c.note }, actorId);
      const created: { id: number; code: string } = await apiClient.post(`/products/${ctx.productId}/use-cases`, body);
      out.push({ ...c, status: 'created', id: created.id, code: created.code });
    } catch (e) {
      const code = (e as { code?: number })?.code;
      // the server is the authority on duplicates (rp-ucase-0090): its refusal is a skip, with the code it names
      if (code === DUPLICATE_USE_CASE) out.push({ ...c, status: 'skip', reason: `服务端判定重复: ${(e as Error).message}`, code: /UC-\d+/.exec((e as Error).message)?.[0] });
      else out.push({ ...c, status: 'failed', reason: describeError(e, ctx.codes) });
    }
  }
  return out;
}

async function createRelations(ctx: Ctx, cases: CaseResult[], includes: PlannedInclude[]): Promise<RelResult[]> {
  const ids = new Map(cases.filter((c) => c.id !== undefined).map((c) => [c.key, c.id as number]));
  let refreshed = false;
  const idFor = async (key: string) => {
    if (!ids.has(key) && !refreshed) {
      refreshed = true;
      (await listExisting(ctx.productId)).forEach((v, k) => ids.set(k, v.id)); // a duplicate the local list did not show
    }
    return ids.get(key);
  };
  const out: RelResult[] = [];
  for (const r of includes) {
    const [from, to] = [await idFor(r.fromKey), await idFor(r.toKey)];
    if (from === undefined || to === undefined) { out.push({ ...r, status: 'failed', reason: '一端的用例没有创建成功或找不到，关系没有建立' }); continue; }
    try {
      await apiClient.post(`/use-cases/${from}/relations`, buildRelationBody({ type: 'include' }, to));
      out.push({ ...r, status: 'created' });
    } catch (e) {
      if ((e as { code?: number })?.code === DUPLICATE_RELATION) out.push({ ...r, status: 'skip', reason: '已有这条 include 关系' });
      else out.push({ ...r, status: 'failed', reason: describeError(e, ctx.codes) });
    }
  }
  return out;
}

// ── report ──

export interface Report {
  mode: 'preview' | 'apply'; productId: number; priority: string; channels: string[]; subModuleId: number | null;
  prejudged: boolean; prejudgeError?: string;
  readErrors: Array<{ path: string; reason: string }>;
  files: Array<{ file: string; actors: number; nodes: number; create: number; skip: number; failed: number; noRole: number; invalid: number; includes: number; extendSkipped: number; unparsed: number }>;
  cases: CaseResult[]; includes: RelResult[];
  noRole: FilePlan['noRole']; invalid: Problem[]; unparsed: Problem[]; skippedDeps: FilePlan['skippedDeps'];
  otherDeps: number; plainIncludeExtend: number; newActors: string[]; failed: boolean;
}

function buildReport(base: Pick<Report, 'mode' | 'productId' | 'priority' | 'channels' | 'subModuleId' | 'prejudged' | 'prejudgeError' | 'readErrors'>, plans: FilePlan[], cases: CaseResult[], includes: RelResult[]): Report {
  const count = (file: string, pick: (c: CaseResult) => boolean) => cases.filter((c) => c.file === file && pick(c)).length;
  const sum = (f: (p: FilePlan) => number) => plans.reduce((n, p) => n + f(p), 0);
  const files = plans.map((p) => ({
    file: p.file, actors: p.actors, nodes: p.nodes,
    create: count(p.file, (c) => c.status === 'create' || c.status === 'created'), skip: count(p.file, (c) => c.status === 'skip'),
    failed: count(p.file, (c) => c.status === 'failed'), noRole: p.noRole.length, invalid: p.invalid.length,
    includes: includes.filter((r) => r.file === p.file && r.status !== 'skip' && r.status !== 'failed').length,
    extendSkipped: p.skippedDeps.filter((d) => d.kind === 'extend').length, unparsed: p.unparsed.length,
  }));
  const failed = base.readErrors.length > 0 || cases.some((c) => c.status === 'failed') || includes.some((r) => r.status === 'failed');
  return {
    ...base, files, cases, includes, failed,
    noRole: plans.flatMap((p) => p.noRole), invalid: plans.flatMap((p) => p.invalid), unparsed: plans.flatMap((p) => p.unparsed),
    skippedDeps: plans.flatMap((p) => p.skippedDeps), otherDeps: sum((p) => p.otherDeps), plainIncludeExtend: sum((p) => p.plainIncludeExtend),
    newActors: Array.from(new Map(cases.filter((c) => c.newActor).map((c) => [actorKey(c.actor), c.actor])).values()),
  };
}

const loc = (x: { file: string; line: number }) => `${shown(x.file)}:${x.line}`;
const STATUS_TEXT: Record<CaseStatus | RelStatus, string> = { create: '将创建', created: '已创建', skip: '跳过', failed: '失败' };

export function renderReport(r: Report, verbose = false): string {
  const apply = r.mode === 'apply';
  const lines = [
    apply ? '导入结果（--apply，已写入）' : '导入预览（未写入任何数据；确认无误后加 --apply 写入）',
    `产品 ${r.productId} · 优先度 ${r.priority} · 要求渠道 ${r.channels.join(',')} · 子模块 ${r.subModuleId ?? '未分模块'}`,
  ];
  if (!r.prejudged) lines.push(`⚠ 没有连上后端，未做重复预判与角色核对（${r.prejudgeError}）；下面的「将创建」包含可能重复的项，实际以服务端校验为准`);
  const cols = ['文件', '角色', '节点', apply ? '已创建' : '将创建', '跳过(重复)', ...(apply ? ['失败'] : []), '无角色', '无法导入', 'include', 'extend跳过', '无法解析'];
  const row = (name: string, f: Report['files'][number]) => [name, f.actors, f.nodes, f.create, f.skip, ...(apply ? [f.failed] : []), f.noRole, f.invalid, f.includes, f.extendSkipped, f.unparsed].map(String);
  const total = r.files.reduce((a, f) => ({
    ...a, actors: a.actors + f.actors, nodes: a.nodes + f.nodes, create: a.create + f.create, skip: a.skip + f.skip, failed: a.failed + f.failed,
    noRole: a.noRole + f.noRole, invalid: a.invalid + f.invalid, includes: a.includes + f.includes, extendSkipped: a.extendSkipped + f.extendSkipped, unparsed: a.unparsed + f.unparsed,
  }), { file: '合计', actors: 0, nodes: 0, create: 0, skip: 0, failed: 0, noRole: 0, invalid: 0, includes: 0, extendSkipped: 0, unparsed: 0 });
  if (r.files.length) lines.push(renderTable([cols, ...r.files.map((f) => row(shown(f.file), f)), ...(r.files.length > 1 ? [row('合计', total)] : [])]));
  if (r.newActors.length) lines.push(`${apply ? '新建' : '将新建'}角色 ${r.newActors.length} 个: ${r.newActors.join('、')}`);

  const section = (title: string, items: string[]) => { if (items.length) lines.push(`\n${title}（${items.length}）`, ...items.map((i) => `  ${i}`)); };
  section('读取失败', r.readErrors.map((e) => `${e.path}: ${e.reason}`));
  section('无法解析的行（不影响其余内容）', r.unparsed.map((p) => `${loc(p)}  ${p.text}  — ${p.reason}`));
  section('无法导入的用例', r.invalid.map((p) => `${loc(p)}  ${p.text}  — ${p.reason}`));
  section('没有连任何角色的节点（不导入）', r.noRole.map((n) => `${loc(n)}  ${n.goal}`));
  section('没有导入的关系', r.skippedDeps.map((d) => `${loc(d)}  ${d.text}  — ${d.reason}`));
  section('用例创建失败', r.cases.filter((c) => c.status === 'failed').map((c) => `${loc(c)}  ${c.actor} / ${c.goal}  — ${c.reason}`));
  section('include 关系失败', r.includes.filter((x) => x.status === 'failed').map((x) => `${loc(x)}  ${x.actor}: ${x.from} → ${x.to}  — ${x.reason}`));
  if (r.otherDeps) lines.push(`\n其余虚线依赖 ${r.otherDeps} 条未转换，已写进相关用例的补充说明${r.plainIncludeExtend ? `（其中 ${r.plainIncludeExtend} 条标签写着 include / extend 但没有 <<>>，按规格不当作关系）` : ''}`);
  if (verbose) {
    section('用例明细', r.cases.map((c) => `[${STATUS_TEXT[c.status]}] ${loc(c)}  ${c.actor} / ${c.goal}${c.reason ? `  — ${c.reason}` : ''}${c.status === 'created' ? `  → ${c.code}` : ''}`));
    section('include 明细', r.includes.map((x) => `[${STATUS_TEXT[x.status]}] ${loc(x)}  ${x.actor}: ${x.from} include ${x.to}${x.reason ? `  — ${x.reason}` : ''}`));
  }
  const n = (s: CaseStatus) => r.cases.filter((c) => c.status === s).length;
  lines.push(apply
    ? `\n汇总: 创建 ${n('created')}，跳过 ${n('skip')}，失败 ${n('failed')}${r.failed ? '（有失败项或读取失败，退出码 1）' : ''}`
    : `\n汇总: 将创建 ${n('create')}，将跳过 ${n('skip')}；include 关系 ${r.includes.length} 条（两端用例已存在时是否已有关系由服务端判定）`);
  return lines.join('\n');
}

// ── entry ──

/** rp-ucase-0088: priority and channels are never guessed. Checked before any file is read or request made. */
function requireFlags(o: ImportFlags): { priority: string; channels: string[]; submodule?: string; subModuleId: number | null } {
  const missing = [o.priority === undefined ? '--priority' : '', o.channels === undefined ? '--channels' : ''].filter(Boolean);
  if (missing.length) throw new InputError(`导入必须由命令参数给出优先度和要求渠道（不替你猜）：缺少 ${missing.join('、')}。例: --priority P1 --channels Web,App`);
  return {
    priority: upper(o.priority as string, PRIORITIES, '--priority'), channels: parseChannels(o.channels, '--channels'),
    submodule: o.submodule, subModuleId: o.submodule === undefined ? null : parseId(o.submodule, '--submodule'),
  };
}

function readPlans(files: string[], readErrors: Collected['errors']): FilePlan[] {
  const plans: FilePlan[] = [];
  for (const f of files) {
    try {
      if (fs.statSync(f).size > MAX_FILE_BYTES) throw new Error(`文件超过 ${MAX_FILE_BYTES / 1024} KB`);
      plans.push(planDiagram(parsePuml(fs.readFileSync(f, 'utf8'), f)));
    } catch (e) {
      readErrors.push({ path: f, reason: `读取失败: ${(e as Error).message}` });
    }
  }
  return plans;
}

/** Returns true when the run must end non-zero (a file could not be read, or an apply left a failure). */
export async function runImport(paths: string[], o: ImportFlags, codes: ErrorCodeMap): Promise<boolean> {
  const flags = requireFlags(o);
  const productId = resolveProductId(o.product);
  const collected = collectFiles(paths);
  if (!collected.files.length && !collected.errors.length) throw new InputError('没有找到 .puml 文件（目录会递归查找）');
  const readErrors = [...collected.errors];
  const plans = readPlans(collected.files, readErrors);
  const ctx: Ctx = { productId, codes, priority: flags.priority, channels: flags.channels, submodule: flags.submodule };

  let server: Server | null = null;
  let prejudgeError: string | undefined;
  try {
    server = await loadServer(productId);
  } catch (e) {
    if (o.apply) throw e; // writing without knowing the product's roles and use cases is not attempted
    prejudgeError = describeError(e, codes);
  }

  let cases = classify(plans, server);
  let includes: RelResult[] = plans.flatMap((p) => p.includes).map((r) => ({ ...r, status: 'create' as const }));
  if (o.apply && server) {
    cases = await createCases(ctx, server, cases);
    includes = await createRelations(ctx, cases, plans.flatMap((p) => p.includes));
  }
  const report = buildReport({
    mode: o.apply ? 'apply' : 'preview', productId, priority: flags.priority, channels: flags.channels, subModuleId: flags.subModuleId,
    prejudged: server !== null, prejudgeError, readErrors,
  }, plans, cases, includes);
  emit(o.json, report, () => renderReport(report, o.verbose));
  return report.failed;
}
