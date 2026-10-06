import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentStateStore, IDLE, advance, busyState } from '../state';

const T0 = Date.parse('2026-10-06T00:00:00.000Z');
const MIN = 60_000;
const busy = busyState({ id: 7, taskNo: 'T7', name: 'x', projectId: 1, estimatedHours: null }, T0, 60);

describe('busyState', () => {
  it('uses estimatedHours when > 0, else expectedMinutes', () => {
    expect(Date.parse(busy.deadline) - T0).toBe(60 * MIN);
    const est = busyState({ id: 1, estimatedHours: 2 }, T0, 60);
    expect(Date.parse(est.deadline) - T0).toBe(120 * MIN);
    expect(busyState({ id: 1, estimatedHours: 0 }, T0, 15).deadline).toBe(new Date(T0 + 15 * MIN).toISOString());
  });
});

describe('advance', () => {
  it('idle stays idle', () => {
    expect(advance(IDLE, T0, 'unknown', 30)).toEqual({ state: IDLE, action: 'none' });
  });

  it('busy before deadline stays busy', () => {
    const r = advance(busy, T0 + 59 * MIN, 'in_progress', 30);
    expect(r).toEqual({ state: busy, action: 'none' });
  });

  it('past deadline -> timeout, no new claim', () => {
    const r = advance(busy, T0 + 61 * MIN, 'in_progress', 30);
    expect(r.state.status).toBe('timeout');
    expect(r.action).toBe('none');
  });

  it('past deadline + grace -> release and idle', () => {
    const r = advance({ ...busy, status: 'timeout' }, T0 + 91 * MIN, 'in_progress', 30);
    expect(r).toEqual({ state: IDLE, action: 'release' });
  });

  it('backend no longer in_progress -> idle without release', () => {
    expect(advance(busy, T0 + 5 * MIN, 'awaiting_plan_approval', 30)).toEqual({ state: IDLE, action: 'finished' });
    expect(advance({ ...busy, status: 'timeout' }, T0 + 200 * MIN, 'completed', 30)).toEqual({
      state: IDLE,
      action: 'finished',
    });
  });

  it('backend lookup failed -> state unchanged (still advances by time)', () => {
    expect(advance(busy, T0 + 5 * MIN, 'unknown', 30)).toEqual({ state: busy, action: 'none' });
    expect(advance(busy, T0 + 65 * MIN, 'unknown', 30).state.status).toBe('timeout');
  });
});

describe('AgentStateStore', () => {
  it('round-trips state, defaults to idle, rejects corrupt file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-state-'));
    const store = new AgentStateStore(dir);
    expect(store.read()).toEqual(IDLE);
    await store.withLock(async () => store.write(busy));
    expect(store.read()).toEqual(busy);
    expect(fs.existsSync(`${store.file}.lock`)).toBe(false);
    fs.writeFileSync(store.file, '{bad');
    expect(() => store.read()).toThrow(/损坏/);
  });

  it('takes over a stale lock', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-state-'));
    const store = new AgentStateStore(dir);
    const lock = `${store.file}.lock`;
    fs.writeFileSync(lock, '');
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(lock, old, old);
    await expect(store.withLock(async () => 'ok')).resolves.toBe('ok');
  });
});
