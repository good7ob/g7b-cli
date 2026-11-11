import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../ApiClient';
import { sessionHeaderValue } from '../session';

const SID = 'aaaaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ENV_KEYS = ['G7B_SESSION_ID', 'CLAUDE_CODE_SESSION_ID'] as const;
const saved = ENV_KEYS.map((k) => process.env[k]);
beforeEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));
afterEach(() => ENV_KEYS.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i]))));

describe('sessionHeaderValue', () => {
  it('sends only the first 10 chars, G7B_SESSION_ID before CLAUDE_CODE_SESSION_ID', () => {
    expect(sessionHeaderValue({ CLAUDE_CODE_SESSION_ID: SID })).toBe('aaaaaaaaaa');
    expect(sessionHeaderValue({ G7B_SESSION_ID: 'zzzzzzzzzz-1', CLAUDE_CODE_SESSION_ID: SID })).toBe('zzzzzzzzzz');
    expect(sessionHeaderValue({ G7B_SESSION_ID: 'short' })).toBe('short');
  });

  it('counts the 10 chars the way the backend does: dashes removed first (a UUID, same identity as its body form)', () => {
    // backend ExecIdentity.session10Of: id.replace("-", "") then the first 10 characters
    expect(sessionHeaderValue({ CLAUDE_CODE_SESSION_ID: '7ebc2aab-5894-4f19-9a3e-2b7d0c1e8f44' })).toBe('7ebc2aab58');
    expect(sessionHeaderValue({ G7B_SESSION_ID: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })).toBe('a1b2c3d4e5');
    expect(sessionHeaderValue({ G7B_SESSION_ID: '---' })).toBeUndefined();
  });
  it('is undefined without an id or with an illegal shape', () => {
    expect(sessionHeaderValue({})).toBeUndefined();
    expect(sessionHeaderValue({ G7B_SESSION_ID: '  ' })).toBeUndefined();
    expect(sessionHeaderValue({ G7B_SESSION_ID: 'bad id!' })).toBeUndefined();
    expect(sessionHeaderValue({ G7B_SESSION_ID: 'x'.repeat(129) })).toBeUndefined();
  });
});

/** Real ApiClient + interceptors; only the network adapter is replaced, to see the headers actually sent. */
async function sentHeaders(call: (c: ApiClient) => Promise<unknown>): Promise<Record<string, unknown>> {
  const client = new ApiClient();
  let seen: Record<string, unknown> = {};
  (client as any).instance.defaults.adapter = async (cfg: any) => {
    seen = { ...cfg.headers };
    return { data: { code: 200, data: null }, status: 200, statusText: 'OK', headers: {}, config: cfg };
  };
  await call(client);
  return seen;
}

describe('X-G7B-Session on every ApiClient request', () => {
  it('adds the 10-char prefix to get and post, and keeps the other headers', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = SID;
    const g = await sentHeaders((c) => c.get('/x'));
    const p = await sentHeaders((c) => c.post('/x', {}));
    expect(g['X-G7B-Session']).toBe('aaaaaaaaaa');
    expect(p['X-G7B-Session']).toBe('aaaaaaaaaa');
    expect(g['X-Time-Format']).toBe('epoch-ms');
    expect(JSON.stringify(g)).not.toContain(SID);
  });
  it('G7B_SESSION_ID wins over CLAUDE_CODE_SESSION_ID', async () => {
    process.env.G7B_SESSION_ID = 'gggggggggg-1';
    process.env.CLAUDE_CODE_SESSION_ID = SID;
    expect((await sentHeaders((c) => c.get('/x')))['X-G7B-Session']).toBe('gggggggggg');
  });
  it('adds no header without a session id or with an illegal one', async () => {
    expect(await sentHeaders((c) => c.get('/x'))).not.toHaveProperty('X-G7B-Session');
    process.env.G7B_SESSION_ID = 'bad id!';
    expect(await sentHeaders((c) => c.get('/x'))).not.toHaveProperty('X-G7B-Session');
  });
  it('--session is a per-command argument and never changes the global header', async () => {
    process.env.CLAUDE_CODE_SESSION_ID = SID;
    // resolveSessionId only feeds the request body; the header still comes from the environment alone
    const { resolveSessionId } = await import('../../commands/agent/exec');
    expect(resolveSessionId('cmdopt-session-xx')).toBe('cmdopt-session-xx');
    expect((await sentHeaders((c) => c.get('/x')))['X-G7B-Session']).toBe('aaaaaaaaaa');
  });
});
