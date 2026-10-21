/**
 * `good7ob sync` — incremental pull of what changed for me (prd-0121 FP-2 rp-gjob-sync-0009..0015, g7b #1601).
 * Backed by GET /api/v1/orgs/{orgId}/activities/sync (backend api-0120). Read-only: it never writes to the platform,
 * only to its own state file under ~/.good7ob/sync.
 */

import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { ConfigService } from '../../services/ConfigService';
import { SyncStateService } from '../../services/SyncStateService';
import { InputError, emit, guarded, parseId } from '../../utils/cliHelpers';
import { resolveOrgId } from '../../utils/resolveOrgId';
import { SyncItem, SyncResult, renderSync } from './render';

const MAX_PAGES = 100;
const DEFAULT_LIMIT = 200;

interface Actor {
  actorType?: string | null;
  userId?: number | null;
  employee?: { id?: number | null; orgId?: number | null } | null;
}

interface FeedPage {
  items?: SyncItem[] | null;
  nextCursor: string;
  hasMore?: boolean;
  windowStart?: string | null;
}

/** Who is calling decides the scope on the server, so identity comes from the credential, never a flag. */
function identityOf(actor: Actor): SyncResult['identity'] {
  if (actor.employee?.id) return { kind: 'emp', id: Number(actor.employee.id) };
  if (actor.userId) return { kind: 'user', id: Number(actor.userId) };
  throw new Error('无法确定当前身份，请先 good7ob whoami 确认登录状态');
}

function orgFor(identity: SyncResult['identity'], actor: Actor, option: string | undefined, configured: number | undefined): number {
  if (identity.kind === 'emp') {
    const own = Number(actor.employee?.orgId);
    if (option !== undefined && Number(option) !== own) {
      throw new InputError(`AI 员工只能同步自己所属的组织（${own}），不能指定 --org-id ${option}`);
    }
    return own;
  }
  return resolveOrgId(option, configured);
}

export function registerSyncCommands(program: Command) {
  program
    .command('sync')
    .description('Pull what changed for me since the last sync (assigned tasks, mentions, followed products; AI employees: own tasks only)')
    .option('--org-id <id>', 'Organization (users: also GOOD7OB_ORG_ID / config org-id; AI employees use their own)')
    .option('--full', 'Ignore the saved cursor and start again from the first-sync window')
    .option('--limit <n>', `Page size (1-200, default ${DEFAULT_LIMIT})`)
    .option('--json', 'Output as JSON')
    .action((o: { orgId?: string; full?: boolean; limit?: string; json?: boolean }) =>
      guarded('同步失败', {}, async () => {
        const limit = o.limit === undefined ? DEFAULT_LIMIT : parseId(o.limit, '--limit');
        if (limit > 200) throw new InputError(`--limit 必须在 1～200 之间，收到: ${o.limit}`);
        if (o.orgId !== undefined) parseId(o.orgId, '--org-id');

        const actor: Actor = await apiClient.get('/api/v1/me/actor');
        const identity = identityOf(actor);
        const orgId = orgFor(identity, actor, o.orgId, new ConfigService().get('orgId'));
        const key = `${identity.kind}-${identity.id}-org${orgId}`;

        const store = new SyncStateService();
        const previous = o.full ? null : store.read(key);
        let cursor = previous?.cursor;
        let windowStart: string | null = null;
        const items: SyncItem[] = [];
        let next = previous?.cursor ?? '';
        let truncated = false;

        // Fetch everything first and write state only after the whole run succeeded (rp-gjob-sync-0015):
        // a failure on page N must leave the cursor where it was, so the next run starts from the same place.
        for (let pages = 1; ; pages++) {
          const feed: FeedPage = await apiClient.get(`/api/v1/orgs/${orgId}/activities/sync`, { limit, ...(cursor ? { cursor } : {}) });
          items.push(...(feed.items ?? []));
          windowStart = windowStart ?? feed.windowStart ?? null;
          next = feed.nextCursor;
          if (!feed.hasMore) break;
          if (pages >= MAX_PAGES) {
            truncated = true;
            break;
          }
          cursor = feed.nextCursor;
        }

        store.write(key, { cursor: next, lastSyncAt: new Date().toISOString(), items });
        const result: SyncResult = {
          identity, orgId, firstSync: !previous, windowStart,
          previousSyncAt: previous?.lastSyncAt ?? null, items, nextCursor: next, truncated,
        };
        emit(o.json, result, () => renderSync(result));
      }));
}
