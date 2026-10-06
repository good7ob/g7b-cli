/**
 * Pure helpers for `good7ob prd import-structure`: parse docs/prd (requirement index + FP/RP
 * tables) and map onto the backend's Feature / Function Point / Rule Point enums. The write itself
 * is done by the server (`POST /forge/structuring/import`, see importPayload.ts). Kept free of
 * apiClient so it can be unit tested.
 */

import fs from 'fs';
import path from 'path';

/** New name first; the legacy name is still accepted (g7b #1496). */
export const INDEX_FILES = ['prd-0000-requirement-index.md', 'prd-0000-good7ob-requirement-index.md'];
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
export interface PrdRp { rpId: string; text: string; type: string; line: number; section?: string }
export interface PrdFp { funId: string; fpType?: string; rps: PrdRp[]; line: number; section?: string; file?: string }
export interface ParsedStructure { rows: IndexRow[]; prdFps: PrdFp[]; /** PRD file (relative path) → document version */ versions: Record<string, string | undefined> }
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
  let h1: string | undefined;
  let h2: string | undefined;
  const lines = md.split('\n');
  lines.forEach((line, i) => {
    if (/^#\s/.test(line)) { h1 = line.replace(/^#\s+/, '').trim(); h2 = undefined; }
    if (/^##\s/.test(line)) { h2 = line.replace(/^##\s+/, '').trim(); current = undefined; inSummary = false; }
    if (SUMMARY_HEADER.test(line)) { inSummary = true; return; }
    if (inSummary) {
      const s = line.match(SUMMARY_ROW);
      if (s) { types.set(s[1], s[2].trim()); return; }
      if (!line.startsWith('|')) inSummary = false;
    }
    const section = [h1, h2].filter(Boolean).join(' > ') || undefined;
    const fpId = line.match(FP_ID_LINE);
    if (fpId) { current = { funId: fpId[1], rps: [], line: i + 1, section }; fps.push(current); return; }
    const rp = line.match(RP_ROW);
    if (rp) {
      if (!current) throw new Error(`第 ${i + 1} 行 ${rp[1]} 不在任何 FP 小节内`);
      current.rps.push({ rpId: rp[1], text: unescapePipes(rp[2]), type: rp[3].trim(), line: i + 1, section });
    }
  });
  return fps.map((fp) => ({ ...fp, fpType: types.get(fp.funId) }));
}

const semverKey = (v: string) => v.split('.').map(Number).reduce((acc, n) => acc * 1000 + n, 0);

/** Highest x.y.z in the version-history table (rows look like `| 1.0.5 | 2026-10-03 | ... |`), or undefined. */
export function parseDocVersion(md: string): string | undefined {
  const versions = md.split('\n')
    .map((line) => line.match(/^\|\s*(\d+\.\d+\.\d+)\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|/)?.[1])
    .filter((v): v is string => !!v);
  return versions.sort((a, b) => semverKey(b) - semverKey(a))[0];
}

function listMarkdown(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '_templates' || e.name.startsWith('.') ? [] : listMarkdown(p);
    return e.name.endsWith('.md') && e.name !== '三层结构改造方案.md' ? [p] : [];
  });
}

export function loadStructure(prdDir: string, onlyFiles?: Set<string>): ParsedStructure {
  const indexPath = INDEX_FILES.map((f) => path.join(prdDir, f)).find((p) => fs.existsSync(p));
  if (!indexPath) throw new Error(`找不到需求索引: ${path.join(prdDir, INDEX_FILES[0])}（旧名 ${INDEX_FILES[1]} 也不存在）`);
  const rows = parseIndex(fs.readFileSync(indexPath, 'utf8'));
  const prdFps: PrdFp[] = [];
  const versions: Record<string, string | undefined> = {};
  const seen = new Map<string, string>();
  for (const file of listMarkdown(prdDir).sort()) {
    const rel = path.relative(prdDir, file);
    if (onlyFiles && !onlyFiles.has(rel) && !onlyFiles.has(path.basename(rel))) continue;
    const md = fs.readFileSync(file, 'utf8');
    if (!/^## FP-/m.test(md)) continue;
    let fps: PrdFp[];
    try { fps = parsePrd(md); } catch (e) { throw new Error(`${rel}: ${e instanceof Error ? e.message : e}`); }
    for (const fp of fps) {
      if (seen.has(fp.funId)) throw new Error(`${fp.funId} 同时出现在 ${seen.get(fp.funId)} 和 ${rel}`);
      seen.set(fp.funId, rel);
    }
    prdFps.push(...fps.map((fp) => ({ ...fp, file: rel })));
    versions[rel] = parseDocVersion(md);
  }
  return { rows, prdFps, versions };
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

/** undefined = the PRD declares no (known) type; callers omit it so the server keeps the existing value (g7b #1496). */
export const mapFpType = (t?: string): string | undefined => (t && FP_TYPES.includes(t) ? t : undefined);
export const mapRpType = (t?: string) => (t && RP_TYPES.includes(t) ? t : RP_TYPE_ALIASES[t ?? ''] ?? 'Other');

export function fpStatusFor(funId: string, indexStatus: IndexStatus, v?: Verified): string {
  const s = v?.fpStatus[funId];
  return s ? VERIFIED_FP_STATUS[s] : INDEX_FP_STATUS[indexStatus];
}

/** Only RPs under a verified FP carry a verdict (unlisted ones there are DONE); otherwise undeclared → undefined, server keeps its value. */
export function rpImplStatusFor(funId: string, rpId: string, v?: Verified): string | undefined {
  return v?.fpStatus[funId] ? v.rpImplStatus[rpId] ?? 'DONE' : undefined;
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
      fpType: mapFpType(prd?.fpType) ?? 'Other',
      description: row.prdLink ? `来源：docs/prd/${row.prdLink.replace(/^\.\//, '')}` : undefined,
      status: fpStatusFor(row.funId, row.status, verified),
      rps: (prd?.rps ?? []).map((rp) => ({
        key: rp.rpId,
        statement: `${rp.rpId} ${rp.text}`,
        rpType: mapRpType(rp.type),
        implStatus: rpImplStatusFor(row.funId, rp.rpId, verified) ?? 'TODO',
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
