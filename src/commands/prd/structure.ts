/**
 * Pure helpers for `good7ob prd import-structure`: parse docs/prd (requirement index + FP/RP
 * tables), map onto the backend's Feature / Function Point / Rule Point enums, and sync
 * idempotently through an injected client. Kept free of apiClient so it can be unit tested.
 */

import fs from 'fs';
import path from 'path';

export const INDEX_FILE = 'prd-0000-good7ob-requirement-index.md';
/** forge_feature.name / forge_function_point.name are VARCHAR(100). */
export const NAME_MAX = 100;

export const FP_TYPES = ['Create', 'Read', 'Update', 'Delete', 'Query', 'Search', 'Filter', 'Import', 'Export', 'Batch',
  'Rule', 'Workflow', 'Integration', 'Notification', 'Report', 'Permission', 'AI', 'Other'];
export const RP_TYPES = ['Input', 'Output', 'Validation', 'Data', 'Error Handling', 'Audit', 'Business Rule', 'Permission',
  'State', 'Notification', 'UI Behavior', 'Workflow', 'Integration', 'Security', 'Performance', 'Other'];
const RP_TYPE_ALIASES: Record<string, string> = { Report: 'Output', Query: 'Output', 'Input/Output': 'Input' };

type IndexStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'SKIP';
const INDEX_FP_STATUS: Record<IndexStatus, string> = { DONE: 'Completed', IN_PROGRESS: 'In Progress', TODO: 'Draft', SKIP: 'On Hold' };
const VERIFIED_FP_STATUS: Record<string, string> = { DONE: 'Completed', PARTIAL: 'In Progress', TODO: 'Ready' };
const RP_IMPL_STATUSES = ['TODO', 'DONE', 'UNVERIFIED'];

export interface IndexRow { featureId: string; featureName: string; funId: string; desc: string; status: IndexStatus; prdLink?: string }
export interface PrdRp { rpId: string; text: string; type: string }
export interface PrdFp { funId: string; fpType?: string; rps: PrdRp[] }
export interface ParsedStructure { rows: IndexRow[]; prdFps: PrdFp[] }
export interface Verified { fpStatus: Record<string, string>; rpImplStatus: Record<string, string> }

export interface DesiredRp { key: string; statement: string; rpType: string; implStatus: string }
export interface DesiredFp { key: string; name: string; fpType: string; description?: string; status: string; rps: DesiredRp[] }
export interface DesiredFeature { key: string; name: string; fps: DesiredFp[] }

const unescapePipes = (s: string) => s.replace(/\\\|/g, '|').trim();

// ── parsing ──────────────────────────────────────────────────────────────

const INDEX_ROW = /^\|\s*(MOD-\d+-SUB-\d+)\s*\|\s*([^|]+?)\s*\|\s*`?(fun-[\w-]+)`?\s*\|\s*(.+?)\s*\|\s*(TODO|IN_PROGRESS|DONE|SKIP)\s*\|\s*(?:\[[^\]]*\]\(([^)]*)\))?/;

export function parseIndex(md: string): IndexRow[] {
  const seen = new Set<string>();
  return md.split('\n').filter((line) => /^\|\s*MOD-\d+-SUB-\d+\s*\|/.test(line)).map((line) => {
    const m = line.match(INDEX_ROW);
    if (!m) throw new Error(`需求索引行无法解析: ${line}`);
    if (seen.has(m[3])) throw new Error(`需求索引中 ${m[3]} 重复出现`);
    seen.add(m[3]);
    return { featureId: m[1], featureName: m[2].trim(), funId: m[3], desc: unescapePipes(m[4]), status: m[5] as IndexStatus, prdLink: m[6] };
  });
}

const SUMMARY_HEADER = /^\|\s*FP ID\s*\|\s*名称\s*\|\s*类型\s*\|/;
const SUMMARY_ROW = /^\|\s*`(fun-[\w-]+)`\s*\|[^|]*\|\s*([^|]+?)\s*\|/;
const FP_ID_LINE = /^\*\*FP ID\*\*\s*[：:]\s*`(fun-[\w-]+)`/;
// Greedy rule text so an escaped "\|" inside it stays in the text; the last two cells are type + complexity.
const RP_ROW = /^\|\s*`(rp-[\w-]+)`\s*\|(.+)\|([^|]+)\|[^|]*\|\s*$/;

/** One PRD file → its FP sections (FP ID line + Rule Points rows), fpType from the FP summary table. */
export function parsePrd(md: string): PrdFp[] {
  const types = new Map<string, string>();
  const fps: PrdFp[] = [];
  let current: PrdFp | undefined;
  let inSummary = false;
  for (const line of md.split('\n')) {
    if (/^##\s/.test(line)) { current = undefined; inSummary = false; }
    if (SUMMARY_HEADER.test(line)) { inSummary = true; continue; }
    if (inSummary) {
      const s = line.match(SUMMARY_ROW);
      if (s) { types.set(s[1], s[2].trim()); continue; }
      if (!line.startsWith('|')) inSummary = false;
    }
    const fpId = line.match(FP_ID_LINE);
    if (fpId) { current = { funId: fpId[1], rps: [] }; fps.push(current); continue; }
    const rp = line.match(RP_ROW);
    if (rp) {
      if (!current) throw new Error(`${rp[1]} 不在任何 FP 小节内`);
      current.rps.push({ rpId: rp[1], text: unescapePipes(rp[2]), type: rp[3].trim() });
    }
  }
  return fps.map((fp) => ({ ...fp, fpType: types.get(fp.funId) }));
}

function listMarkdown(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '_templates' || e.name.startsWith('.') ? [] : listMarkdown(p);
    return e.name.endsWith('.md') && e.name !== '三层结构改造方案.md' ? [p] : [];
  });
}

export function loadStructure(prdDir: string): ParsedStructure {
  const indexPath = path.join(prdDir, INDEX_FILE);
  if (!fs.existsSync(indexPath)) throw new Error(`找不到需求索引: ${indexPath}`);
  const rows = parseIndex(fs.readFileSync(indexPath, 'utf8'));
  const prdFps: PrdFp[] = [];
  const seen = new Map<string, string>();
  for (const file of listMarkdown(prdDir).sort()) {
    const md = fs.readFileSync(file, 'utf8');
    if (!/^## FP-/m.test(md)) continue;
    const rel = path.relative(prdDir, file);
    let fps: PrdFp[];
    try { fps = parsePrd(md); } catch (e) { throw new Error(`${rel}: ${e instanceof Error ? e.message : e}`); }
    for (const fp of fps) {
      if (seen.has(fp.funId)) throw new Error(`${fp.funId} 同时出现在 ${seen.get(fp.funId)} 和 ${rel}`);
      seen.set(fp.funId, rel);
    }
    prdFps.push(...fps);
  }
  return { rows, prdFps };
}

export function parseVerified(raw: unknown): Verified {
  const bad = (m: string) => new Error(`--verified JSON 格式不正确: ${m}`);
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(raw)) throw bad('根节点必须是对象');
  if (!isObj(raw.fpStatus)) throw bad('缺少对象字段 fpStatus（{ "fun-...": "DONE"|"PARTIAL"|"TODO" }）');
  if (raw.rpImplStatus !== undefined && !isObj(raw.rpImplStatus)) throw bad('rpImplStatus 必须是对象');
  const check = (obj: Record<string, unknown>, field: string, allowed: string[]) => Object.entries(obj).forEach(([k, v]) => {
    if (!allowed.includes(v as string)) throw bad(`${field}["${k}"] = ${JSON.stringify(v)}，应为 ${allowed.join('|')}`);
  });
  const rpImplStatus = (raw.rpImplStatus ?? {}) as Record<string, unknown>;
  check(raw.fpStatus, 'fpStatus', Object.keys(VERIFIED_FP_STATUS));
  check(rpImplStatus, 'rpImplStatus', RP_IMPL_STATUSES);
  return { fpStatus: raw.fpStatus as Record<string, string>, rpImplStatus: rpImplStatus as Record<string, string> };
}

// ── mapping ──────────────────────────────────────────────────────────────

export const mapFpType = (t?: string) => (t && FP_TYPES.includes(t) ? t : 'Other');
export const mapRpType = (t?: string) => (t && RP_TYPES.includes(t) ? t : RP_TYPE_ALIASES[t ?? ''] ?? 'Other');

export function fpStatusFor(funId: string, indexStatus: IndexStatus, v?: Verified): string {
  const s = v?.fpStatus[funId];
  return s ? VERIFIED_FP_STATUS[s] : INDEX_FP_STATUS[indexStatus];
}

/** Only RPs under a verified FP carry a verdict; unlisted ones there are DONE, everything else is unverified work → TODO. */
export function rpImplStatusFor(funId: string, rpId: string, v?: Verified): string {
  return v?.fpStatus[funId] ? v.rpImplStatus[rpId] ?? 'DONE' : 'TODO';
}

/** Truncate to max UTF-16 units without splitting a surrogate pair; the leading id token always survives. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const chars = Array.from(s);
  while (chars.join('').length > max - 1) chars.pop();
  return `${chars.join('')}…`;
}

export function buildDesired(parsed: ParsedStructure, verified?: Verified): { features: DesiredFeature[]; warnings: string[] } {
  const prdByFun = new Map(parsed.prdFps.map((fp) => [fp.funId, fp]));
  const indexed = new Set(parsed.rows.map((r) => r.funId));
  const rpIds = new Set(parsed.prdFps.flatMap((fp) => fp.rps.map((rp) => rp.rpId)));
  const warnings = [
    ...parsed.prdFps.filter((fp) => !indexed.has(fp.funId)).map((fp) => `PRD 中的 ${fp.funId} 不在需求索引里，已跳过（含 ${fp.rps.length} 个 RP）`),
    ...Object.keys(verified?.fpStatus ?? {}).filter((id) => !indexed.has(id)).map((id) => `--verified fpStatus 中的 ${id} 不在需求索引里`),
    ...Object.keys(verified?.rpImplStatus ?? {}).filter((id) => !rpIds.has(id)).map((id) => `--verified rpImplStatus 中的 ${id} 在 PRD 中找不到`),
  ];

  const features = new Map<string, DesiredFeature>();
  for (const row of parsed.rows) {
    if (!features.has(row.featureId)) {
      features.set(row.featureId, { key: row.featureId, name: clip(`${row.featureId} ${row.featureName}`, NAME_MAX), fps: [] });
    }
    const prd = prdByFun.get(row.funId);
    features.get(row.featureId).fps.push({
      key: row.funId,
      name: clip(`${row.funId} ${row.desc}`, NAME_MAX),
      fpType: mapFpType(prd?.fpType),
      description: row.prdLink ? `来源：docs/prd/${row.prdLink.replace(/^\.\//, '')}` : undefined,
      status: fpStatusFor(row.funId, row.status, verified),
      rps: (prd?.rps ?? []).map((rp) => ({
        key: rp.rpId,
        statement: `${rp.rpId} ${rp.text}`,
        rpType: mapRpType(rp.type),
        implStatus: rpImplStatusFor(row.funId, rp.rpId, verified),
      })),
    });
  }
  return { features: [...features.values()], warnings };
}

export function summarize(features: DesiredFeature[]) {
  const tally = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
  const fps = features.flatMap((f) => f.fps);
  const rps = fps.flatMap((fp) => fp.rps);
  return {
    features: features.length, fps: fps.length, rps: rps.length,
    fpStatus: tally(fps.map((fp) => fp.status)),
    rpImplStatus: tally(rps.map((rp) => rp.implStatus)),
  };
}

// ── sync ─────────────────────────────────────────────────────────────────

export interface StructureClient {
  get(url: string, params?: Record<string, any>): Promise<any>;
  post(url: string, body?: any): Promise<any>;
  put(url: string, body?: any): Promise<any>;
}
export type Layer = 'feature' | 'fp' | 'rp';
export interface SyncAction { layer: Layer; op: 'create' | 'update'; id: string; field?: string; from?: string; to?: string }
export interface SyncResult { counts: Record<Layer, { create: number; update: number; unchanged: number }>; actions: SyncAction[] }

/** Existing rows keyed by the leading id token of name/statement (MOD-xx-SUB-yy / fun-… / rp-…). */
const byLeadingId = (rows: any[], field: string) =>
  new Map<string, any>((rows ?? []).map((r) => [String(r[field] ?? '').trim().split(/\s+/)[0], r]));

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  const lane = async () => {
    while (!failed && next < items.length) {
      const item = items[next++];
      try { await worker(item); } catch (e) { failed = true; throw e; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}

/**
 * Create missing nodes, update FP status / RP implStatus only when different, never delete.
 * dryRun reads existing data and records the plan without writing.
 */
export async function syncStructure(
  client: StructureClient, productId: number, features: DesiredFeature[],
  opts: { dryRun: boolean; concurrency: number; tenantId?: number; retryDelaysMs?: number[] },
): Promise<SyncResult> {
  const zero = () => ({ create: 0, update: 0, unchanged: 0 });
  const result: SyncResult = { counts: { feature: zero(), fp: zero(), rp: zero() }, actions: [] };
  const record = (layer: Layer, op: 'create' | 'update' | 'unchanged', id: string, change?: Partial<SyncAction>) => {
    result.counts[layer][op] += 1;
    if (op !== 'unchanged') result.actions.push({ layer, op, id, ...change });
  };
  // 一次完整导入是上千次写请求，后端按用户维度限流，撞上 429 就退避重试；
  // 其它错误仍然立刻中止（幂等，重跑即可续上）。
  const RETRY_DELAYS_MS = opts.retryDelaysMs ?? [2000, 4000, 8000, 16000, 30000];
  const isRateLimited = (m: string) => /Too many requests|429|请求过于频繁/i.test(m);
  const at = async <T>(id: string, call: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isRateLimited(msg) && attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          continue;
        }
        throw new Error(`${id}: ${msg}`);
      }
    }
  };

  const syncRp = async (fpRow: any, existing: Map<string, any>, rp: DesiredRp) => {
    const row = existing.get(rp.key);
    if (!row) {
      record('rp', 'create', rp.key);
      if (opts.dryRun) return;
      const created = await at(rp.key, () => client.post('/forge/rule-points',
        { functionPointId: fpRow.id, statement: rp.statement, rpType: rp.rpType, implStatus: rp.implStatus }));
      if ((created?.implStatus ?? 'TODO') !== rp.implStatus) {
        await at(rp.key, () => client.put(`/forge/rule-points/${created.id}/impl-status`, { implStatus: rp.implStatus }));
      }
      return;
    }
    const current = row.implStatus ?? 'TODO';
    if (current === rp.implStatus) { record('rp', 'unchanged', rp.key); return; }
    record('rp', 'update', rp.key, { field: 'implStatus', from: current, to: rp.implStatus });
    if (!opts.dryRun) await at(rp.key, () => client.put(`/forge/rule-points/${row.id}/impl-status`, { implStatus: rp.implStatus }));
  };

  const syncFp = async (featureRow: any, existing: Map<string, any>, fp: DesiredFp) => {
    let row = existing.get(fp.key);
    if (!row) {
      record('fp', 'create', fp.key);
      if (!opts.dryRun) {
        row = await at(fp.key, () => client.post('/forge/function-points',
          { featureId: featureRow.id, name: fp.name, fpType: fp.fpType, description: fp.description }));
        if (row.status !== fp.status) await at(fp.key, () => client.put(`/forge/function-points/${row.id}/status`, { status: fp.status }));
      }
      for (const rp of fp.rps) await syncRp(row, new Map(), rp);
      return;
    }
    if (row.status === fp.status) record('fp', 'unchanged', fp.key);
    else {
      record('fp', 'update', fp.key, { field: 'status', from: row.status, to: fp.status });
      if (!opts.dryRun) await at(fp.key, () => client.put(`/forge/function-points/${row.id}/status`, { status: fp.status }));
    }
    const rps = byLeadingId(await at(fp.key, () => client.get('/forge/rule-points', { functionPointId: row.id })), 'statement');
    for (const rp of fp.rps) await syncRp(row, rps, rp);
  };

  try {
    const existing = byLeadingId(await at(`product ${productId}`, () => client.get('/forge/features', { productId })), 'name');
    // ponytail: parallel across Features only, FPs/RPs inside one Feature go sequentially; fan out deeper if imports get slow.
    await runPool(features, opts.concurrency, async (feature) => {
      let row = existing.get(feature.key);
      let fps = new Map<string, any>();
      if (row) {
        record('feature', 'unchanged', feature.key);
        fps = byLeadingId(await at(feature.key, () => client.get('/forge/function-points', { featureId: row.id })), 'name');
      } else {
        record('feature', 'create', feature.key);
        // 后端 forge_feature.tenant_id 非空，缺了会 500；tenantId 与组织 ID 同源（前端同约定）。
        if (!opts.dryRun) {
          if (!opts.tenantId) throw new Error('缺少 --tenant（租户/组织 ID）：新建 Feature 必须提供');
          row = await at(feature.key, () => client.post('/forge/features',
            { productId, tenantId: opts.tenantId, name: feature.name }));
        }
      }
      for (const fp of feature.fps) await syncFp(row, fps, fp);
    });
  } catch (e) {
    const err: any = e instanceof Error ? e : new Error(String(e));
    err.partial = result;
    throw err;
  }
  return result;
}
