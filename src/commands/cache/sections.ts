/**
 * The four cached sections. Each fetches from the platform and returns the complete file set of its
 * directory plus the `updatedAt` stamps that let the next pull skip unchanged items.
 */

import apiClient from '../../services/ApiClient';
import { rateLimitRetry, runPool } from '../../utils/pool';
import { safeName } from './store';

export interface SectionResult {
  /** Items on the platform side (PRDs, docs, apps, tasks), not the number of files written */
  count: number;
  files: Record<string, string>;
  stamps: Record<string, string>;
}

export interface SectionContext {
  productId: number;
  orgId: number;
  prevStamps: Record<string, string>;
  /** Content written by an earlier pull, or null */
  readOld: (name: string) => string | null;
}

export type SectionPuller = (ctx: SectionContext) => Promise<SectionResult>;

const PAGE_SIZE = 50;
const MAX_PAGES = 200;
const CONCURRENCY = 4;
const retry = rateLimitRetry();

const cell = (v: unknown): string => String(v ?? '-').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const table = (head: string[], rows: unknown[][]): string =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
const frontMatter = (meta: Record<string, unknown>): string =>
  `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${JSON.stringify(v ?? null)}`).join('\n')}\n---\n\n`;

/** Page through a list endpoint until `total` rows are collected (or a page comes back empty). */
async function fetchAll<T>(fetchPage: (page: number) => Promise<{ rows: T[]; total: number }>): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { rows, total } = await fetchPage(page);
    all.push(...rows);
    if (rows.length === 0 || all.length >= total) return all;
  }
  throw new Error(`分页超过 ${MAX_PAGES} 页，已中止`);
}

/** Shared by PRDs and design docs: fetch the detail of changed items only, reuse the file of unchanged ones. */
async function pullDocs<R>(
  ctx: SectionContext,
  rows: R[],
  item: { key: (r: R) => string; stamp: (r: R) => string; fetch: (r: R) => Promise<unknown>; render: (r: R, detail: any) => string },
): Promise<SectionResult> {
  const files: Record<string, string> = {};
  const stamps: Record<string, string> = {};
  await runPool(rows, CONCURRENCY, async (r) => {
    const key = item.key(r);
    const name = `${safeName(key)}.md`;
    const stamp = item.stamp(r);
    const old = ctx.prevStamps[key] === stamp ? ctx.readOld(name) : null;
    files[name] = old ?? item.render(r, await retry(key, () => item.fetch(r)));
    stamps[key] = stamp;
  });
  return { count: rows.length, files, stamps };
}

const withIndex = (result: SectionResult, head: string[], rows: unknown[][]): SectionResult => ({
  ...result,
  files: { ...result.files, 'INDEX.md': `${table(head, rows)}\n` },
});

export const pullPrd: SectionPuller = async (ctx) => {
  const rows = await fetchAll<any>(async (page) => {
    const res = await apiClient.get('/forge/prd/prds', { productId: ctx.productId, page, pageSize: PAGE_SIZE });
    return { rows: res?.list ?? [], total: res?.total ?? 0 };
  });
  const docs = await pullDocs(ctx, rows, {
    key: (r) => r.prdNo ?? `prd-${r.prdId}`,
    stamp: (r) => String(r.updatedAt),
    fetch: (r) => apiClient.get(`/forge/prd/prds/${r.prdId}`),
    render: (r, d) =>
      frontMatter({ prdNo: r.prdNo, prdId: r.prdId, title: r.title, status: r.status, version: d?.version ?? r.version, updatedAt: r.updatedAt })
      + (d?.currentDocument?.contentMd ?? '（尚无正文）'),
  });
  return withIndex(docs, ['PRD 编号', '标题', '状态', '版本', '更新时间'],
    rows.map((r) => [r.prdNo, r.title, r.status, r.version, r.updatedAt]));
};

export const pullDesign: SectionPuller = async (ctx) => {
  const base = `/forge/products/${ctx.productId}/designs`;
  const rows = await fetchAll<any>(async (pageNum) => {
    const res = await apiClient.get(base, { pageNum, pageSize: PAGE_SIZE });
    return { rows: res?.records ?? [], total: res?.total ?? 0 };
  });
  const docs = await pullDocs(ctx, rows, {
    key: (r) => r.docNo,
    stamp: (r) => String(r.updatedAt),
    fetch: (r) => apiClient.get(`${base}/${encodeURIComponent(r.docNo)}`),
    render: (r, d) => {
      const version = d?.publishedVersion ?? d?.draftVersion;
      const label = d?.publishedVersion ? version?.versionLabel : version ? `${version.versionLabel}（草稿）` : null;
      return frontMatter({ docNo: r.docNo, docType: r.docType, title: r.title, status: r.status, version: label, updatedAt: r.updatedAt })
        + (version?.contentMd ?? '（尚无正文）');
    },
  });
  return withIndex(docs, ['编号', '类型', '标题', '状态', '更新时间'],
    rows.map((r) => [r.docNo, r.docType, r.title, r.status, r.updatedAt]));
};

/** UI design is small and has no per-item version, so it is refetched whole. Org-level apps (no product) are included. */
export const pullUi: SectionPuller = async (ctx) => {
  const base = '/forge/ui-design';
  const apps: any[] = ((await apiClient.get(`${base}/apps`, { orgId: ctx.orgId })) ?? [])
    .filter((a: any) => a.productId == null || Number(a.productId) === ctx.productId);
  const tree = await Promise.all(apps.map(async (app) => {
    const [screens, flows]: [any[], any[]] = await Promise.all([
      apiClient.get(`${base}/apps/${app.id}/screens`), apiClient.get(`${base}/apps/${app.id}/flows`),
    ]);
    const withNodes = await Promise.all((flows ?? []).map(async (flow) => ({ flow, nodes: (await apiClient.get(`${base}/flows/${flow.id}/nodes`)) ?? [] })));
    return { app, screens: screens ?? [], flows: withNodes };
  }));
  const md = tree.map(({ app, screens, flows }) => {
    const name = new Map<number, string>(screens.map((s: any) => [s.id, s.name]));
    const nodeLine = (n: any) => `  - ${name.get(n.fromScreenId) ?? '(起点)'} → ${name.get(n.toScreenId) ?? n.toScreenId}`
      + `${n.trigger ? ` · ${n.trigger}` : ''}${n.condition ? ` · 条件: ${n.condition}` : ''}`;
    return [
      `## ${app.name}（${app.platform}）${app.productId == null ? ' · 组织级' : ''}`,
      '', '### 页面', ...screens.map((s: any) => `- ${s.name}${s.description ? `：${s.description}` : ''}`),
      '', '### 画面迁移', ...flows.flatMap(({ flow, nodes }) => [`- ${flow.name}`, ...nodes.map(nodeLine)]), '',
    ].join('\n');
  });
  return { count: apps.length, files: { 'ui.md': `# UI 设计\n\n${md.join('\n')}`, 'ui.json': JSON.stringify(tree, null, 2) }, stamps: {} };
};

/** Tasks come back as one unpaged array per project (about 3 MB for a large one), so the whole project is refetched. */
export const pullTasks: SectionPuller = async (ctx) => {
  const projects = await fetchAll<any>(async (page) => {
    const res = await apiClient.get('/progress/projects', { productId: ctx.productId, page, pageSize: PAGE_SIZE });
    return { rows: res?.list ?? [], total: res?.total ?? 0 };
  });
  const perProject = await Promise.all(projects.map(async (p) => ({ p, tasks: ((await apiClient.get(`/progress/projects/${p.id}/tasks`)) ?? []) as any[] })));
  const all = perProject.flatMap(({ p, tasks }) => tasks.map((t) => ({ ...t, projectName: p.name })));
  const sorted = [...all].sort((a, b) => (a.projectId - b.projectId) || (b.id - a.id));
  return {
    count: all.length,
    files: {
      'tasks.json': JSON.stringify(all),
      'INDEX.md': `${table(['项目', '任务号', 'ID', '状态', '优先级', '名称'], sorted.map((t) => [t.projectName, t.taskNo, t.id, t.status, t.priority, t.name]))}\n`,
    },
    stamps: {},
  };
};

export const SECTIONS: Record<string, SectionPuller> = { prd: pullPrd, design: pullDesign, ui: pullUi, tasks: pullTasks };
