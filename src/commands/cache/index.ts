/**
 * `good7ob cache` — keep a product's PRDs, design docs, UI design and tasks on disk as Markdown, so an agent
 * can Read / grep them instead of calling the API again. Read-only towards the platform; `pull` is the only
 * thing that talks to it, and it is incremental (an item whose `updatedAt` did not change is not refetched).
 *
 * Layout: ~/.good7ob/cache/<identity>-org<N>/product-<id>/{manifest.json, prd/, design/, ui/, tasks/}
 */

import { Command } from 'commander';
import apiClient from '../../services/ApiClient';
import { ConfigService } from '../../services/ConfigService';
import { emit, guarded, parseId, requireOneOf } from '../../utils/cliHelpers';
import { Actor, identityOf, orgFor } from '../sync';
import { SECTIONS } from './sections';
import { CacheStore, Manifest } from './store';

const NAMES = Object.keys(SECTIONS);

interface Scope {
  store: CacheStore;
  productId: number;
  orgId: number;
}

async function resolveScope(o: { product: string; orgId?: string }): Promise<Scope> {
  const productId = parseId(o.product, '--product');
  if (o.orgId !== undefined) parseId(o.orgId, '--org-id');
  const actor: Actor = await apiClient.get('/api/v1/me/actor');
  const identity = identityOf(actor);
  const orgId = orgFor(identity, actor, o.orgId, new ConfigService().get('orgId'));
  return { store: new CacheStore(`${identity.kind}-${identity.id}-org${orgId}`, productId), productId, orgId };
}

function parseOnly(raw: string | undefined): string[] {
  if (!raw) return NAMES;
  return raw.split(',').map((s) => requireOneOf(s.trim(), NAMES as readonly string[], '--only'));
}

async function pull(scope: Scope, names: string[]): Promise<Manifest> {
  const { store, productId, orgId } = scope;
  const prev = store.readManifest();
  const sections = { ...(prev?.sections ?? {}) };
  const errors = Object.fromEntries(Object.entries(prev?.errors ?? {}).filter(([name]) => !names.includes(name)));
  for (const name of names) {
    try {
      const result = await SECTIONS[name]({
        productId, orgId,
        prevStamps: prev?.sections[name]?.stamps ?? {},
        readOld: (file) => store.readFile(name, file),
      });
      store.writeSection(name, result.files);
      sections[name] = { count: result.count, pulledAt: new Date().toISOString(), stamps: result.stamps };
    } catch (e) {
      errors[name] = e instanceof Error ? e.message : String(e); // the previous section on disk stays as it was
    }
  }
  const manifest: Manifest = { productId, orgId, pulledAt: new Date().toISOString(), sections, errors };
  store.writeManifest(manifest);
  return manifest;
}

const renderManifest = (dir: string, m: Manifest): string => [
  `缓存目录: ${dir}`,
  `最近拉取: ${m.pulledAt}`,
  ...NAMES.filter((n) => m.sections[n] || m.errors[n]).map((n) =>
    `  ${n.padEnd(7)} ${m.errors[n] ? `失败（保留上次内容）: ${m.errors[n]}` : `${m.sections[n].count} 项 · ${m.sections[n].pulledAt}`}`),
].join('\n');

export function registerCacheCommands(program: Command) {
  const cache = program.command('cache').description('Local Markdown cache of a product\'s PRDs, design docs, UI design and tasks (read it with Read/grep instead of calling the API)');

  cache
    .command('pull')
    .description('Fetch (incrementally) into the local cache; sections: prd, design, ui, tasks')
    .requiredOption('--product <id>', 'Product id')
    .option('--org-id <id>', 'Organization (users: also GOOD7OB_ORG_ID / config org-id; AI employees use their own)')
    .option('--only <sections>', `Comma-separated subset of ${NAMES.join(',')} (default: all)`)
    .option('--json', 'Output as JSON')
    .action((o: { product: string; orgId?: string; only?: string; json?: boolean }) => {
      let manifest: Manifest | undefined;
      let dir = '';
      return guarded('缓存失败', {}, async () => {
        const names = parseOnly(o.only);
        const scope = await resolveScope(o);
        manifest = await pull(scope, names);
        dir = scope.store.dir;
        emit(o.json, { dir, ...manifest }, () => renderManifest(dir, manifest as Manifest));
      }).then(() => {
        if (manifest && Object.keys(manifest.errors).length > 0) process.exit(1);
      });
    });

  cache
    .command('status')
    .description('Show what is cached for a product and when it was last pulled')
    .requiredOption('--product <id>', 'Product id')
    .option('--org-id <id>', 'Organization')
    .option('--json', 'Output as JSON')
    .action((o: { product: string; orgId?: string; json?: boolean }) =>
      guarded('读取缓存状态失败', {}, async () => {
        const { store } = await resolveScope(o);
        const manifest = store.readManifest();
        emit(o.json, { dir: store.dir, manifest }, () =>
          manifest ? renderManifest(store.dir, manifest) : `尚未缓存（${store.dir}），先运行 good7ob cache pull --product ${o.product}`);
      }));
}
