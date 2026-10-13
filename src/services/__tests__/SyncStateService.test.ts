import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SNAPSHOT_LIMIT, SyncStateService } from '../SyncStateService';

let dir: string;
let svc: SyncStateService;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-syncstate-'));
  svc = new SyncStateService({ stateDir: dir });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('SyncStateService', () => {
  it('returns null for an identity that never synced', () => {
    expect(svc.read('user-11-org58')).toBeNull();
  });

  it('round-trips and leaves no temp file behind', () => {
    svc.write('user-11-org58', { cursor: 'a1.c2.w3', lastSyncAt: '2026-10-13T09:00:00.000Z', items: [{ id: 1 }] });
    expect(svc.read('user-11-org58')).toEqual({ cursor: 'a1.c2.w3', lastSyncAt: '2026-10-13T09:00:00.000Z', items: [{ id: 1 }] });
    expect(fs.readdirSync(dir)).toEqual(['user-11-org58.json']);
  });

  it('keeps only the newest SNAPSHOT_LIMIT items', () => {
    const items = Array.from({ length: SNAPSHOT_LIMIT + 5 }, (_, i) => ({ id: i }));
    svc.write('emp-3-org58', { cursor: 'a1.c0.w1', lastSyncAt: 'x', items });
    const back = svc.read('emp-3-org58')!;
    expect(back.items).toHaveLength(SNAPSHOT_LIMIT);
    expect(back.items[0]).toEqual({ id: 5 });
  });

  it('refuses a corrupt or cursor-less file', () => {
    fs.writeFileSync(path.join(dir, 'user-1-org1.json'), '{oops');
    expect(() => svc.read('user-1-org1')).toThrow('损坏');
    fs.writeFileSync(path.join(dir, 'user-2-org1.json'), JSON.stringify({ items: [] }));
    expect(() => svc.read('user-2-org1')).toThrow('损坏');
  });

  it('rejects keys that could escape the state directory', () => {
    expect(() => svc.fileFor('../evil')).toThrow('非法');
    expect(() => svc.fileFor('user-1-org1/../../x')).toThrow('非法');
  });

  it('writes the file owner-only', () => {
    svc.write('user-11-org58', { cursor: 'a', lastSyncAt: 'x', items: [] });
    expect(fs.statSync(path.join(dir, 'user-11-org58.json')).mode & 0o777).toBe(0o600);
  });
});
