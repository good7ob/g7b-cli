/**
 * Local state of `good7ob sync`: `~/.good7ob/sync/<identity>-org<orgId>.json` (prd-0121 rp-gjob-sync-0011, g7b #1601).
 *
 * One file per identity + organization, so switching account or organization never reuses another cursor and two
 * identities never overwrite each other. The cursor is opaque (the server decides its format) and is only
 * advanced after a whole run succeeded. Never synced to the backend.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Items kept as the local snapshot of the last run (for other commands such as gjob-rpt). */
export const SNAPSHOT_LIMIT = 500;

export interface SyncState {
  cursor: string;
  lastSyncAt: string;
  items: unknown[];
}

export interface SyncStateOptions {
  /** Directory holding the state files. Default `~/.good7ob/sync`, resolved on every call so a changed HOME is honoured. */
  stateDir?: string;
}

export class SyncStateService {
  constructor(private readonly options: SyncStateOptions = {}) {}

  private get stateDir(): string {
    return this.options.stateDir ?? path.join(os.homedir(), '.good7ob', 'sync');
  }

  fileFor(key: string): string {
    if (!/^[a-z]+-[0-9]+-org[0-9]+$/.test(key)) throw new Error(`非法的同步状态键: ${key}`);
    return path.join(this.stateDir, `${key}.json`);
  }

  /** `null` when this identity + organization has never synced. A corrupt file is an error, never "empty". */
  read(key: string): SyncState | null {
    const file = this.fileFor(key);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<SyncState>;
      if (typeof raw.cursor !== 'string' || !raw.cursor) throw new Error('缺少 cursor');
      return { cursor: raw.cursor, lastSyncAt: String(raw.lastSyncAt ?? ''), items: Array.isArray(raw.items) ? raw.items : [] };
    } catch (err) {
      // Treating it as empty would silently restart from the 7-day window and re-report old changes.
      throw new Error(`同步状态文件损坏（${file}）: ${(err as Error).message}。确认无误后可删除该文件，或加 --full 重新同步`);
    }
  }

  /** Atomic: write a temp file in the same directory, then rename over the target. */
  write(key: string, state: SyncState): void {
    const file = this.fileFor(key);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...state, items: state.items.slice(-SNAPSHOT_LIMIT) }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
}
