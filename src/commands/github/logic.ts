/** Pure logic for `good7ob github sync` (prd-0124): row mapping, since-date, pagination narrowing, batching. */
import { fmtDateTime } from '../../utils/cliHelpers';

export const PAGE_SIZE = 200;
export const BATCH_SIZE = 200;
export const MAX_PAGES = 20;
const DAY = 86_400_000;
const JST = 9 * 3_600_000;

export interface GhPr {
  number: number;
  title: string;
  url: string;
  state: string;
  author?: { login?: string | null } | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  baseRefName: string;
  headRefName: string;
  createdAt: string;
  mergedAt?: string | null;
  closedAt?: string | null;
  updatedAt: string;
}

export interface PrItem {
  repoFullName: string;
  prNumber: number;
  title: string;
  htmlUrl: string;
  state: 'open' | 'closed';
  authorLogin: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  baseRef: string;
  headRef: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
}

/** gh prints Go's zero time (0001-01-01...) or "" for "not set". */
const realTime = (v: string | null | undefined): string | null => (!v || v.startsWith('0001-') ? null : v);

export function mapPr(repoFullName: string, r: GhPr): PrItem {
  return {
    repoFullName,
    prNumber: r.number,
    title: r.title,
    htmlUrl: r.url,
    // merged is sent as closed; the server derives merged from mergedAt.
    state: r.state.toLowerCase() === 'open' ? 'open' : 'closed',
    authorLogin: r.author?.login ?? null,
    additions: r.additions,
    deletions: r.deletions,
    changedFiles: r.changedFiles,
    baseRef: r.baseRefName,
    headRef: r.headRefName,
    createdAt: r.createdAt,
    mergedAt: realTime(r.mergedAt),
    closedAt: realTime(r.closedAt),
    updatedAt: r.updatedAt,
  };
}

const jstDate = (ms: number): string => new Date(ms + JST).toISOString().slice(0, 10);

/**
 * Start date (YYYY-MM-DD) of the PR query: --since wins; first sync = today(JST) - 90 days;
 * otherwise lastSyncedAt(JST date) - 1 day. Server times are naive JST wall time unless they carry Z/offset.
 */
export function sinceFor(lastSyncedAt: unknown, override: string | undefined, now: Date = new Date()): string {
  if (override) return override;
  if (lastSyncedAt === null || lastSyncedAt === undefined || lastSyncedAt === '') return jstDate(now.getTime() - 90 * DAY);
  const text = fmtDateTime(lastSyncedAt).replace(' ', 'T');
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(text);
  const day = hasZone ? jstDate(new Date(text).getTime()) : text.slice(0, 10);
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
}

export function batchesOf<T>(items: readonly T[], size: number = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface Collected {
  rows: GhPr[];
  capped: boolean;
}

/**
 * gh caps one query at 200 rows. When a page comes back full, repeat the query with an extra
 * `updated:<=<oldest updatedAt of that page>` (rows are newest-updated first) until a page has < 200 rows.
 * The boundary row repeats, so rows are de-duplicated by PR number; a full page that adds nothing new
 * (200+ PRs sharing one timestamp) stops the loop. At most `maxPages` pages; `capped` tells the caller to warn.
 */
export async function collectPrs(
  repo: string,
  since: string,
  fetchPage: (search: string) => Promise<GhPr[]>,
  maxPages: number = MAX_PAGES,
): Promise<Collected> {
  const byNumber = new Map<number, GhPr>();
  let search = `updated:>=${since}`;
  for (let page = 1; page <= maxPages; page++) {
    const rows = await fetchPage(search);
    const before = byNumber.size;
    rows.forEach((r) => byNumber.set(r.number, r));
    if (rows.length < PAGE_SIZE || byNumber.size === before) return { rows: [...byNumber.values()], capped: false };
    const oldest = rows.reduce((a, r) => (r.updatedAt < a ? r.updatedAt : a), rows[0].updatedAt);
    search = `updated:>=${since} updated:<=${oldest}`;
  }
  return { rows: [...byNumber.values()], capped: true };
}
