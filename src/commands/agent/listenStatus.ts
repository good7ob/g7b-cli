/**
 * What `agent listen` last reported about itself, for `good7ob setup` (wait for the first heartbeat) and
 * `good7ob service status` (last heartbeat, key rejected) — g7b #3633, design 7.4 / 7.7-5.
 *
 * `<data dir>/listen-status.json`: `{ pid, runnerId, lastBeatAt, keyInvalidAt }`. Writes are best effort: a full disk
 * must never stop the runner, so every error is swallowed.
 */

import * as fs from 'fs';
import * as path from 'path';

export const LISTEN_STATUS_FILE = 'listen-status.json';

export interface ListenStatus {
  pid?: number;
  runnerId?: number;
  /** ISO time of the last heartbeat the backend accepted. */
  lastBeatAt?: string;
  /** ISO time the key was rejected (401); cleared by the next successful registration. */
  keyInvalidAt?: string;
}

export function listenStatusFile(dir: string): string {
  return path.join(dir, LISTEN_STATUS_FILE);
}

export function readListenStatus(dir: string): ListenStatus {
  try {
    const raw = JSON.parse(fs.readFileSync(listenStatusFile(dir), 'utf-8'));
    return raw && typeof raw === 'object' ? (raw as ListenStatus) : {};
  } catch {
    return {};
  }
}

/** Merges `patch` (an `undefined` value removes the field) and writes atomically. */
export function updateListenStatus(dir: string, patch: Partial<Record<keyof ListenStatus, unknown>>): void {
  try {
    const next: Record<string, unknown> = { ...readListenStatus(dir) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = listenStatusFile(dir);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    /* best effort */
  }
}
