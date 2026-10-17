/** Pure logic for `good7ob artifact` (prd-0126 FP-7): file scan, kind / RP-code extraction, batching, rendering. */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Chunk size of an ordinary sync; kept at the server's original per-call limit so it works against any version. */
export const BATCH_SIZE = 200;
/**
 * A full scan must go in one call, otherwise files of other chunks would look missing and be marked removed.
 * The server's per-call limit is 1000 from backend PR "raise artifact sync limit" on (rp-pm-artifact-0009).
 */
export const FULL_SCAN_MAX = 1000;
export const KINDS = ['wireframe', 'ddd_arc', 'ddd_db', 'ddd_api'] as const;
export type Kind = (typeof KINDS)[number];
export const DEFAULT_EXTENSIONS = ['.md', '.html'];
const SKIP_DIRS = new Set(['.git', 'node_modules']);

export interface ArtifactItem {
  kind: Kind;
  repoFullName: string;
  path: string;
  contentHash: string;
  commitSha?: string;
  rpCodes: string[];
}

export interface ScannedFile {
  relPath: string;
  content: Buffer;
}

export const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

/** `rp-<prefix>-NNNN`, same rule as the backend's RuleCodeParser: no letter, digit or dash glued on either side. */
const RP_CODE = /(?<![a-z0-9-])rp-[a-z0-9]+(?:-[a-z0-9]+)*-\d{4,}(?![a-z0-9-])/gi;

/** Distinct lower-case RP codes in first-seen order (rp-pm-artifact-0003). */
export function extractRpCodes(text: string): string[] {
  return [...new Set((text.match(RP_CODE) ?? []).map((c) => c.toLowerCase()))];
}

/** ddd documents are named arc- / db- / api-NNNN-…; anything else needs an explicit --kind. */
export function inferKind(relPath: string): Kind | null {
  const name = path.basename(relPath).toLowerCase();
  if (name.startsWith('arc-')) return 'ddd_arc';
  if (name.startsWith('db-')) return 'ddd_db';
  if (name.startsWith('api-')) return 'ddd_api';
  return null;
}

/** Recursive walk in a stable order; hidden directories, .git and node_modules are skipped. */
export function scanDir(root: string, extensions: string[] = DEFAULT_EXTENSIONS): ScannedFile[] {
  const wanted = new Set(extensions.map((e) => e.toLowerCase()));
  const found: ScannedFile[] = [];
  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(full);
      } else if (entry.isFile() && wanted.has(path.extname(entry.name).toLowerCase())) {
        found.push({ relPath: path.relative(root, full).split(path.sep).join('/'), content: fs.readFileSync(full) });
      }
    }
  };
  walk(root);
  return found;
}

export interface BuildResult {
  items: ArtifactItem[];
  /** Files that were not uploaded because no kind could be decided. */
  undecided: string[];
}

/** `kind` is a fixed kind, or `auto` to infer it from the file name. */
export function buildItems(files: ScannedFile[], repoFullName: string, commitSha: string | undefined, kind: Kind | 'auto'): BuildResult {
  const items: ArtifactItem[] = [];
  const undecided: string[] = [];
  for (const f of files) {
    const k = kind === 'auto' ? inferKind(f.relPath) : kind;
    if (!k) {
      undecided.push(f.relPath);
      continue;
    }
    items.push({
      kind: k,
      repoFullName,
      path: f.relPath,
      contentHash: sha256Hex(f.content),
      commitSha,
      rpCodes: extractRpCodes(f.content.toString('utf8')),
    });
  }
  return { items, undecided };
}

export function batchesOf<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** `git@github.com:owner/name.git`, `https://github.com/owner/name(.git)` → `owner/name`; anything else → null. */
export function repoFromRemote(url: string): string | null {
  const m = url.trim().match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

export interface SyncItemResult {
  repoFullName: string;
  path: string;
  action: string;
  message?: string;
  linksAdded: number;
  linksRemoved: number;
  unknownCodes: string[];
}

export interface SyncResult {
  dryRun: boolean;
  items: SyncItemResult[];
  counts: Record<string, number>;
}

/** Merges the results of several batches into one. */
export function mergeResults(results: SyncResult[]): SyncResult {
  const merged: SyncResult = { dryRun: results.length > 0 && results.every((r) => r.dryRun), items: [], counts: {} };
  for (const r of results) {
    merged.items.push(...r.items);
    for (const [k, v] of Object.entries(r.counts ?? {})) merged.counts[k] = (merged.counts[k] ?? 0) + v;
  }
  return merged;
}

const ACTION_LABEL: Record<string, string> = { created: '新增', updated: '更新', unchanged: '未变', removed: '移除', failed: '失败' };

export function renderSyncSummary(r: SyncResult): string {
  const counts = ['created', 'updated', 'unchanged', 'removed', 'failed']
    .map((k) => `${ACTION_LABEL[k]} ${r.counts[k] ?? 0}`).join('，');
  const lines = [`${r.dryRun ? '（dry-run，未写入）' : '✓ 同步完成'} ${counts}`];
  const linksAdded = r.items.reduce((s, i) => s + i.linksAdded, 0);
  const linksRemoved = r.items.reduce((s, i) => s + i.linksRemoved, 0);
  lines.push(`RP 关联：新增 ${linksAdded}，移除 ${linksRemoved}`);
  const unknown = [...new Set(r.items.flatMap((i) => i.unknownCodes))];
  if (unknown.length > 0) lines.push(`未识别编号（产品需求结构里没有，未建立关联）：${unknown.join(', ')}`);
  for (const i of r.items.filter((x) => x.action === 'failed')) lines.push(`✗ ${i.path}: ${i.message ?? '失败'}`);
  return lines.join('\n');
}

export interface StageCount { done: number; total: number; stale: number }
export interface ProgressRow {
  level: string;
  key: string;
  name?: string | null;
  prdStatus?: string | null;
  ruleCount: number;
  stages: Record<string, StageCount> | null;
}
export interface RuleProgress {
  code: string;
  fpCode?: string;
  stages: Record<string, { status: string; stale: boolean }>;
}

export const COUNTED_STAGES = ['definition', 'wireframe', 'design', 'code', 'testCase'] as const;
export const STAGE_LABEL: Record<string, string> = {
  definition: '定义', wireframe: '画面', design: '设计', code: '代码', testCase: '用例', testResult: '测试结果',
};
const STATUS_MARK: Record<string, string> = { DONE: '✓', IN_PROGRESS: '◐', NOT_STARTED: '·', NO_RESULT: '无结果' };

/** `done/total`, with ⚠n when n of them are stale; a row without rule points shows a dash, never 0 (rp-pm-artifact-0032). */
export function stageCell(row: ProgressRow, stage: string): string {
  const c = row.stages?.[stage];
  if (!c) return '—';
  return `${c.done}/${c.total}${c.stale > 0 ? ` ⚠${c.stale}` : ''}`;
}

export function ruleCell(rule: RuleProgress, stage: string): string {
  const s = rule.stages[stage];
  if (!s) return '—';
  return `${STATUS_MARK[s.status] ?? s.status}${s.stale ? ' ⚠' : ''}`;
}
