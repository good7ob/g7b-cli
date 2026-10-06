import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveAgentConfig } from '../config';
import { Api, runRound } from '../round';
import { AgentStateStore, IDLE, busyState } from '../state';

const T0 = Date.parse('2026-10-06T00:00:00.000Z');
const cfg = resolveAgentConfig({});
const conflict = () => Object.assign(new Error('已被领取'), { code: 409 });

function setup(api: Partial<Api>) {
  const store = new AgentStateStore(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-round-')));
  const fake = { get: vi.fn(api.get), post: vi.fn(api.post ?? (async () => ({}))) };
  return { store, api: fake, deps: { api: fake, store, cfg, now: () => T0 } };
}

describe('runRound', () => {
  it('busy: checks the task but does not pull the queue', async () => {
    const { store, api, deps } = setup({ get: async () => ({ status: 'in_progress' }) });
    store.write(busyState({ id: 7 }, T0, 60));
    const r = await runRound(deps, vi.fn());
    expect(r.kind).toBe('busy');
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/progress/tasks/7');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('idle: skips a 409 and claims the next one', async () => {
    const { store, api, deps } = setup({
      get: async () => [{ id: 1 }, { id: 2, taskNo: 'T2', name: 'two', estimatedHours: 1 }],
      post: async (url: string) => {
        if (url === '/progress/tasks/1/claim') throw conflict();
        return { id: 2, taskNo: 'T2', name: 'two', status: 'in_progress', estimatedHours: 1 };
      },
    });
    const forward = vi.fn(async () => undefined);
    const r = await runRound(deps, forward);
    expect(r.kind).toBe('claimed');
    expect(api.post.mock.calls.map((c) => c[0])).toEqual(['/progress/tasks/1/claim', '/progress/tasks/2/claim']);
    const slot = store.read();
    expect(slot).toMatchObject({ status: 'busy', taskId: 2, taskNo: 'T2', deadline: new Date(T0 + 3600_000).toISOString() });
    expect(forward).toHaveBeenCalledWith(expect.objectContaining({ id: 2, taskNo: 'T2', claimedAtMs: T0 }));
  });

  it('passes agent.projectId to the queue query', async () => {
    const { api, deps } = setup({ get: async () => [] });
    const r = await runRound({ ...deps, cfg: { ...cfg, projectId: 9 } });
    expect(r.kind).toBe('empty');
    expect(api.get).toHaveBeenCalledWith('/progress/agent-tasks', { projectId: 9 });
  });

  it('forward failure releases the task and frees the slot', async () => {
    const { store, api, deps } = setup({
      get: async () => [{ id: 5 }],
      post: async (url: string) =>
        url.endsWith('/claim') ? { id: 5, status: 'in_progress' } : { taskId: 5, status: 'pending_agent', releaseCount: 1 },
    });
    const r = await runRound(deps, async () => {
      throw new Error('webhook 返回 HTTP 500');
    });
    expect(r.kind).toBe('forward_failed');
    expect(api.post).toHaveBeenLastCalledWith('/progress/tasks/5/release', {
      reason: '转交本机 agent 失败: webhook 返回 HTTP 500',
    });
    expect(store.read()).toEqual(IDLE);
  });

  it('past deadline + grace: releases with a reason, then claims anew in the same round', async () => {
    const { store, api, deps } = setup({
      get: async (url: string) => (url === '/progress/tasks/7' ? { status: 'in_progress' } : []),
      post: async () => ({ taskId: 7, status: 'pending_agent', releaseCount: 1 }),
    });
    store.write(busyState({ id: 7 }, T0 - 91 * 60_000, 60));
    const r = await runRound(deps);
    expect(r.kind).toBe('empty');
    const [url, body] = api.post.mock.calls[0] as any[];
    expect(url).toBe('/progress/tasks/7/release');
    expect(body.reason).toMatch(/超时疑似 agent 中断.*预计时长 60 分钟/);
    expect(store.read()).toEqual(IDLE);
  });

  it('task moved on by the agent: frees the slot without releasing', async () => {
    const { store, api, deps } = setup({
      get: async (url: string) => (url === '/progress/tasks/7' ? { status: 'completed' } : []),
    });
    store.write(busyState({ id: 7 }, T0, 60));
    await runRound(deps);
    expect(api.post).not.toHaveBeenCalled();
    expect(store.read()).toEqual(IDLE);
  });

  it('status lookup failure leaves the slot unchanged', async () => {
    const { store, deps } = setup({
      get: async () => {
        throw new Error('network');
      },
    });
    const slot = busyState({ id: 7 }, T0, 60);
    store.write(slot);
    expect((await runRound(deps)).kind).toBe('busy');
    expect(store.read()).toEqual(slot);
  });
});
