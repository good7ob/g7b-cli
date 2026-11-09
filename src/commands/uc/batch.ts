/**
 * The two commands that render on this machine and upload the PNG: `push` (one flow diagram, source included) and
 * `render` (every stale or unrendered flow diagram and overview, each succeeding or failing on its own).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import apiClient from '../../services/ApiClient';
import { describeError } from '../../utils/cliHelpers';
import { runPool } from '../../utils/pool';
import { RenderError, Renderer, describeRenderError } from './plantuml';
import { BatchItem, DiagramRow, OverviewRow, UcListItem } from './render';
import { checkPngSize, sourceHash } from './source';

export const RENDER_SOURCE_CHANGED = 15013;
const LIST_CONCURRENCY = 4;

/** POST a multipart form with the PNG under `file`. ApiClient.uploadFiles takes paths, so the PNG goes via a temp file. */
async function postPng(url: string, fields: Record<string, string>, png: Buffer): Promise<any> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-uc-png-'));
  try {
    const file = path.join(dir, 'render.png');
    fs.writeFileSync(file, png);
    return await apiClient.uploadFiles(url, [file], 'file', fields);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The form fields of D03 (api-0180 §13.2). `source` is the normalized text that was hashed and rendered. */
export function pushFields(o: { name: string; type: string; source: string; hash: string; version: string }): Record<string, string> {
  return { name: o.name, diagramType: o.type, source: o.source, sourceSha256: o.hash, plantumlVersion: o.version };
}

export interface PushOutcome { diagram: any; warning?: string }

/**
 * rp-ucase-0050: render first; only a successful render reaches the server. `resolveId` runs after the render so a
 * failed render makes no request at all.
 */
export async function pushDiagram(renderer: Renderer, source: string, o: { name: string; type: string }, resolveId: () => Promise<number>): Promise<PushOutcome> {
  const { png, version } = await renderer.render(source); // throws RenderError / SetupError: nothing is sent
  const verdict = checkPngSize(png.length);
  if (verdict.error) throw new RenderError(verdict.error);
  const useCaseId = await resolveId();
  const diagram = await postPng(`/use-cases/${useCaseId}/diagrams`, pushFields({ ...o, source, hash: sourceHash(source), version }), png);
  return { diagram, warning: verdict.warning };
}

// ── render ──

export interface RenderScope {
  productId: number;
  overview?: string;       // a key, or 'all'
  diagrams?: boolean;
  useCase?: { id: number; code: string }; // only the flow diagrams of this use case
  all?: boolean;           // also the ones that are already up to date
}

interface Target { label: string; run: (renderer: Renderer) => Promise<string> }
export interface BatchPlan { targets: Target[]; skipped: number; failures: BatchItem[] }

const stale = (f?: { upToDate?: boolean }) => f?.upToDate !== true;

async function listAllUseCases(productId: number): Promise<UcListItem[]> {
  const rows: UcListItem[] = [];
  for (let page = 1; ; page++) {
    const data = (await apiClient.get(`/products/${productId}/use-cases`, { pageNum: page, pageSize: 100 })) ?? {};
    rows.push(...(data.records ?? []));
    if (page >= (data.pages ?? 1) || !(data.records ?? []).length) return rows;
  }
}

/**
 * Render one source and upload it. A 15013 means the data changed between fetching the source and uploading: fetch it
 * again and render that, once (api-0180 §13.8).
 */
async function renderAndUpload(renderer: Renderer, fetchSource: () => Promise<string>, upload: (fields: Record<string, string>, png: Buffer) => Promise<any>): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const source = await fetchSource();
    const { png, version } = await renderer.render(source);
    const verdict = checkPngSize(png.length);
    if (verdict.error) throw new RenderError(verdict.error);
    try {
      return await upload({ sourceSha256: sourceHash(source), plantumlVersion: version }, png);
    } catch (e) {
      if ((e as { code?: number })?.code === RENDER_SOURCE_CHANGED && attempt === 0) continue;
      throw e;
    }
  }
}

const sha12 = (r: any) => String(r?.latestRender?.sourceSha256 ?? '').slice(0, 12);
const uploaded = (view: any) => `已渲染并上传（渲染 #${view?.latestRender?.id ?? '?'}，源码 ${sha12(view) || '—'}）`;

function overviewTarget(productId: number, o: OverviewRow): Target {
  const base = `/products/${productId}/use-case-diagrams/${encodeURIComponent(o.key)}`;
  let listed: string | undefined = o.source; // the first attempt renders what the listing returned; a retry re-reads
  const fetchSource = async () => {
    if (listed !== undefined) { const s = listed; listed = undefined; return s; }
    return String((await apiClient.get(base)).source);
  };
  return {
    label: `总图 ${o.key}（${o.name}）`,
    run: async (renderer) => uploaded(await renderAndUpload(renderer, fetchSource, (fields, png) => postPng(`${base}/renders`, fields, png))),
  };
}

function diagramTarget(uc: UcListItem, d: DiagramRow): Target {
  const base = `/use-cases/${uc.id}/diagrams/${d.id}`;
  return {
    label: `${uc.code} 流程图「${d.name}」`,
    run: async (renderer) => uploaded(await renderAndUpload(
      renderer,
      async () => String((await apiClient.get(base)).source),
      (fields, png) => postPng(`${base}/renders`, fields, png))),
  };
}

/** What to render for a scope: stale or unrendered by default, everything with `all`. Listing failures are failures. */
export async function planRender(scope: RenderScope): Promise<BatchPlan> {
  const { productId } = scope;
  const wantOverviews = scope.overview !== undefined || (!scope.diagrams && scope.useCase === undefined);
  const wantDiagrams = !!scope.diagrams || scope.useCase !== undefined || scope.overview === undefined;
  const plan: BatchPlan = { targets: [], skipped: 0, failures: [] };
  const take = (fresh: boolean, t: Target) => (scope.all || !fresh ? plan.targets.push(t) : void plan.skipped++);

  if (wantOverviews) {
    const all: OverviewRow[] = (await apiClient.get(`/products/${productId}/use-case-diagrams`)) ?? [];
    const chosen = scope.overview && scope.overview !== 'all' ? all.filter((o) => o.key === scope.overview) : all;
    if (scope.overview && scope.overview !== 'all' && !chosen.length) {
      throw new Error(`产品 ${productId} 没有总图 ${scope.overview}（可用: ${all.map((o) => o.key).join('、') || '无'}）`);
    }
    chosen.forEach((o) => take(!stale(o.freshness), overviewTarget(productId, o)));
  }
  if (wantDiagrams) {
    const useCases = scope.useCase ? [scope.useCase as UcListItem] : await listAllUseCases(productId);
    const perUc: Target[][] = [];
    await runPool(useCases, LIST_CONCURRENCY, async (uc) => {
      try {
        const diagrams: DiagramRow[] = (await apiClient.get(`/use-cases/${uc.id}/diagrams`)) ?? [];
        const targets: Target[] = [];
        diagrams.forEach((d) => (scope.all || stale(d.freshness) ? targets.push(diagramTarget(uc, d)) : void plan.skipped++));
        perUc[useCases.indexOf(uc)] = targets;
      } catch (e) {
        plan.failures.push({ label: `${uc.code} 流程图清单`, ok: false, message: `读取失败: ${describeError(e)}` });
      }
    });
    perUc.forEach((ts) => ts && plan.targets.push(...ts));
  }
  return plan;
}

/** rp-ucase-0067: every target on its own; a failure never undoes or stops the others. */
export async function runPlan(plan: BatchPlan, renderer: Renderer): Promise<BatchItem[]> {
  const items: BatchItem[] = [...plan.failures];
  for (const t of plan.targets) {
    try {
      items.push({ label: t.label, ok: true, message: await t.run(renderer) });
    } catch (e) {
      items.push({ label: t.label, ok: false, message: e instanceof RenderError ? describeRenderError(e) : describeError(e) });
    }
  }
  return items;
}
