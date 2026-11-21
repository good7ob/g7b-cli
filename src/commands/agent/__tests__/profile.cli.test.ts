import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EXIT_KEY_INVALID, registerAgentCommands } from '../index';
import { bizError, httpError, ok, runCli } from '../../../utils/__tests__/cliHarness';
import configService from '../../../services/ConfigService';
import { ConfigService } from '../../../services/ConfigService';
import { dataDir } from '../../../services/flavor';
import { PROFILE_ENV, writeEnvFile } from '../../../services/profile';
import { AgentStateStore } from '../state';
import { runRound } from '../round';
import { KEY_INVALID_MESSAGE } from '../runner';
import { INVALID_TOKEN, REDEEM_PATH, enroll } from '../enroll';

// Same isolation as agent.cli.test.ts: os.homedir() is mocked so nothing touches the real ~/.good7ob*.
vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as typeof import('os');
  const homedir = () => (globalThis as { __agentTestHome?: string }).__agentTestHome ?? '/nonexistent-test-home';
  return { ...actual, default: { ...actual, homedir }, homedir };
});

let tmpHome: string;
const profileRoot = (name: string) => path.join(tmpHome, '.good7ob-profiles', name);
const defaultRoot = () => path.join(tmpHome, '.good7ob');

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-profile-'));
  (globalThis as { __agentTestHome?: string }).__agentTestHome = tmpHome;
  delete process.env[PROFILE_ENV];
});
afterEach(() => {
  delete process.env[PROFILE_ENV];
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const TOKEN = 'g7e_' + 'A'.repeat(43);
const EMPLOYEE_KEY = 'g7k_SECRET_EMPLOYEE_KEY_0123456789';
const MODEL_KEY = 'sk-ant-SECRET-MODEL-KEY-abcdef';
const answer = (over: Record<string, unknown> = {}) => ({
  orgId: 115,
  orgName: '远见科技',
  aiEmployeeId: 41,
  aiEmployeeName: '开发助理',
  profile: 'org115-emp41',
  key: EMPLOYEE_KEY,
  modelKeys: [{ provider: 'anthropic', env: 'ANTHROPIC_API_KEY', key: MODEL_KEY }],
  ...over,
});
const httpOk = (data: unknown) => ({ status: 200, data: { code: 200, msg: '操作成功', data } });

describe('dataDir follows the active profile', () => {
  it('work slot, heartbeat and runner.log of a profile stay out of the default root', () => {
    expect(dataDir()).toBe(defaultRoot());
    process.env[PROFILE_ENV] = 'p1';
    expect(dataDir()).toBe(profileRoot('p1'));
    expect(new AgentStateStore().file).toBe(path.join(profileRoot('p1'), 'agent-state.json'));
  });
});

describe('two profiles on one machine run agent listen side by side', () => {
  beforeEach(() => {
    vi.spyOn(configService, 'saveConfig').mockImplementation(() => undefined);
    configService.set('agent', { forward: { command: 'true' } });
  });
  afterEach(() => configService.set('agent', undefined));

  const listenAs = (profile: string, taskId: number, runnerId: number) => {
    process.env[PROFILE_ENV] = profile;
    return runCli(registerAgentCommands, ['agent', 'listen', '--once', '--host-id', `h-${profile}`], (m, url) => {
      if (m === 'post' && url === '/api/v1/me/runners') return ok({ id: runnerId, hostKey: `h-${profile}` });
      if (m === 'post' && url === '/api/v1/me/heartbeat') return ok({ stopStepIds: [] });
      if (m === 'get') return ok([{ id: taskId, taskNo: `T${taskId}`, name: `task ${taskId}` }]);
      return ok({ id: taskId, status: 'in_progress' });
    });
  };

  it('each claims into its own slot and registration; a busy profile does not block the other', async () => {
    const a = await listenAs('org1-emp1', 101, 11);
    expect(a.exitCode).toBeUndefined();
    // profile a now holds task 101; b still claims its own task instead of reporting "busy"
    const b = await listenAs('org2-emp2', 202, 22);
    expect(b.exitCode).toBeUndefined();
    expect(b.stdout).toContain('已领取任务 #202');

    const slotA = new AgentStateStore(profileRoot('org1-emp1'));
    const slotB = new AgentStateStore(profileRoot('org2-emp2'));
    expect(slotA.read()).toMatchObject({ status: 'busy', taskId: 101 });
    expect(slotB.read()).toMatchObject({ status: 'busy', taskId: 202 });
    expect(slotA.readRunner()).toMatchObject({ runnerId: 11, runnerKey: 'h-org1-emp1' });
    expect(slotB.readRunner()).toMatchObject({ runnerId: 22, runnerKey: 'h-org2-emp2' });
    expect(fs.existsSync(path.join(defaultRoot(), 'agent-state.json'))).toBe(false);

    // each profile keeps its own runner.log
    expect(fs.readFileSync(path.join(profileRoot('org1-emp1'), 'runner.log'), 'utf-8')).toContain('已领取任务 #101');
    expect(fs.readFileSync(path.join(profileRoot('org2-emp2'), 'runner.log'), 'utf-8')).not.toContain('#101');
  });

  it('rounds of two profiles run concurrently: the lock of one never waits on the other', async () => {
    const storeA = new AgentStateStore(dataDir(undefined, undefined, 'a'));
    const storeB = new AgentStateStore(dataDir(undefined, undefined, 'b'));
    const api = (taskId: number) => ({
      get: async () => [{ id: taskId }],
      post: async () => ({ id: taskId, status: 'in_progress' }),
    });
    const cfg = { intervalSeconds: 15, expectedMinutes: 60, graceMinutes: 30, forward: {} };
    let releaseA!: () => void;
    const heldA = storeA.withLock(() => new Promise<void>((r) => (releaseA = r)));
    // A's lock is held for as long as B's whole round takes: B must not wait for it
    const b = await runRound({ api: api(2), store: storeB, cfg });
    expect(b.kind).toBe('claimed');
    releaseA();
    await heldA;
    const [ra, rb] = await Promise.all([runRound({ api: api(1), store: storeA, cfg }), runRound({ api: api(3), store: storeB, cfg })]);
    expect(ra.kind).toBe('claimed');
    expect(rb.kind).toBe('busy');
    expect(storeA.read()).toMatchObject({ taskId: 1 });
    expect(storeB.read()).toMatchObject({ taskId: 2 });
  });
});

describe('agent listen with a profile', () => {
  beforeEach(() => {
    vi.spyOn(configService, 'saveConfig').mockImplementation(() => undefined);
  });
  afterEach(() => configService.set('agent', undefined));

  it("hands the profile's env file (model key) and the profile name to the forward command", async () => {
    process.env[PROFILE_ENV] = 'org115-emp41';
    writeEnvFile(profileRoot('org115-emp41'), { ANTHROPIC_API_KEY: MODEL_KEY });
    const out = path.join(tmpHome, 'child-env.txt');
    configService.set('agent', { forward: { command: `printf '%s|%s' "$ANTHROPIC_API_KEY" "$${PROFILE_ENV}" > '${out}'` } });
    const r = await runCli(registerAgentCommands, ['agent', 'listen', '--once'], (m, url) => {
      if (m === 'post' && url === '/api/v1/me/runners') return ok({ id: 5 });
      if (m === 'post' && url === '/api/v1/me/heartbeat') return ok({});
      if (m === 'get') return ok([{ id: 9 }]);
      return ok({ id: 9, status: 'in_progress' });
    });
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('任务 #9 已转交本机 agent');
    expect(fs.readFileSync(out, 'utf-8')).toBe(`${MODEL_KEY}|org115-emp41`);
    // the variable name is shown, the value never
    expect(r.stdout).toContain('转交命令附带环境变量: ANTHROPIC_API_KEY');
    expect(r.stdout + r.stderr).not.toContain(MODEL_KEY);
    expect(fs.readFileSync(path.join(profileRoot('org115-emp41'), 'runner.log'), 'utf-8')).not.toContain(MODEL_KEY);
  });

  const unauthorized = httpError(401, { code: 401, msg: '未授权' });

  it('uses the contract wording verbatim', () => {
    expect(KEY_INVALID_MESSAGE).toBe('这台设备的 Key 已失效，请重新接入');
  });

  it.each([
    ['registering', (m: string, url: string) => (m === 'post' && url === '/api/v1/me/runners' ? unauthorized : ok([]))],
    ['polling the queue', (m: string, url: string) => (url === '/api/v1/me/runners' ? ok({ id: 5 }) : m === 'get' ? unauthorized : ok({}))],
    ['claiming', (m: string, url: string) => (url === '/api/v1/me/runners' ? ok({ id: 5 }) : m === 'get' ? ok([{ id: 9 }]) : url.includes('/claim') ? unauthorized : ok({}))],
    ['the heartbeat', (m: string, url: string) => (url === '/api/v1/me/runners' ? ok({ id: 5 }) : url === '/api/v1/me/heartbeat' && m === 'post' ? unauthorized : ok([]))],
  ])('a 401 while %s stops claiming, prints and logs the contract message, exits non-zero', async (_label, responder) => {
    process.env[PROFILE_ENV] = 'p401';
    configService.set('agent', { forward: { command: 'true' } });
    const r = await runCli(registerAgentCommands, ['agent', 'listen', '--once'], responder as never);
    expect(r.exitCode).toBe(EXIT_KEY_INVALID);
    expect(r.stderr).toContain(KEY_INVALID_MESSAGE);
    expect(fs.readFileSync(path.join(profileRoot('p401'), 'runner.log'), 'utf-8')).toContain(KEY_INVALID_MESSAGE);
    // nothing was claimed after the 401
    expect(new AgentStateStore(profileRoot('p401')).read()).toEqual({ status: 'idle' });
  });

  it('a 401 without a profile also exits non-zero, and writes no runner.log', async () => {
    configService.set('agent', { forward: { command: 'true' } });
    const r = await runCli(registerAgentCommands, ['agent', 'listen', '--once'], (m, url) =>
      url === '/api/v1/me/runners' ? ok({ id: 5 }) : m === 'get' ? unauthorized : ok({})
    );
    expect(r.exitCode).toBe(EXIT_KEY_INVALID);
    expect(r.stderr).toContain(KEY_INVALID_MESSAGE);
    expect(fs.existsSync(path.join(defaultRoot(), 'runner.log'))).toBe(false);
  });

  it('a human key (403) keeps the old message and exit 1', async () => {
    configService.set('agent', { forward: { command: 'true' } });
    const r = await runCli(registerAgentCommands, ['agent', 'listen', '--once'], (m, url) =>
      url === '/api/v1/me/runners' ? bizError(403, '仅 AI 员工 Key 可注册 Runner') : ok([])
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).not.toContain(KEY_INVALID_MESSAGE);
  });
});

describe('good7ob agent enroll', () => {
  const secretsIn = (text: string) => [TOKEN, EMPLOYEE_KEY, MODEL_KEY].filter((s) => text.includes(s));

  it('redeems, writes key + apiUrl + hostId into the profile from the answer, model keys into env (600), never prints a key', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue(httpOk(answer()) as never);
    const r = await runCli(registerAgentCommands, ['agent', 'enroll', TOKEN, '--api-url', 'https://api-dev.good7ob.net/']);
    expect(r.exitCode).toBeUndefined();

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, cfg] = post.mock.calls[0] as [string, any, any];
    expect(url).toBe(`https://api-dev.good7ob.net${REDEEM_PATH}`);
    expect(body).toEqual({ token: TOKEN, hostId: expect.stringMatching(/^[A-Za-z0-9._-]+-[0-9a-f]{8}$/), hostName: os.hostname(), agentKind: 'CLAUDE_CODE' });
    expect(cfg.headers.Authorization).toBeUndefined();

    const dir = profileRoot('org115-emp41');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));
    expect(saved).toMatchObject({ apiUrl: 'https://api-dev.good7ob.net', apiKey: EMPLOYEE_KEY, orgId: 115, agent: { hostId: body.hostId } });
    expect(fs.statSync(path.join(dir, 'config.json')).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(path.join(dir, 'env'), 'utf-8')).toBe(`ANTHROPIC_API_KEY=${MODEL_KEY}\n`);
    expect(fs.statSync(path.join(dir, 'env')).mode & 0o777).toBe(0o600);
    // the default root got no key
    expect(fs.existsSync(path.join(defaultRoot(), 'config.json'))).toBe(false);

    expect(r.stdout).toContain('✓ 已接入：开发助理（组织 远见科技）');
    expect(r.stdout).toContain('配置档: org115-emp41');
    expect(r.stdout).toContain('下一步: good7ob --profile org115-emp41 agent listen');
    expect(secretsIn(r.stdout + r.stderr)).toEqual([]);

    const j = await (async () => {
      post.mockResolvedValue(httpOk(answer()) as never);
      return runCli(registerAgentCommands, ['agent', 'enroll', TOKEN, '--json']);
    })();
    expect(JSON.parse(j.stdout)).toMatchObject({ profile: 'org115-emp41', modelKeyEnvs: ['ANTHROPIC_API_KEY'], aiEmployeeName: '开发助理' });
    expect(secretsIn(j.stdout + j.stderr)).toEqual([]);
  });

  it('a retry sends the same hostId (re-redeem within 15 minutes), and listen registers under it', async () => {
    const post = vi
      .spyOn(axios, 'post')
      .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET', config: { data: JSON.stringify({ token: TOKEN }) } }))
      .mockResolvedValueOnce(httpOk(answer()) as never);
    const lost = await runCli(registerAgentCommands, ['agent', 'enroll', TOKEN]);
    expect(lost.exitCode).toBe(1);
    expect(lost.stderr).toContain('无法连接');
    expect(secretsIn(lost.stdout + lost.stderr)).toEqual([]);
    const retry = await runCli(registerAgentCommands, ['agent', 'enroll', TOKEN]);
    expect(retry.exitCode).toBeUndefined();
    const [first, second] = post.mock.calls.map((c) => (c[1] as any).hostId);
    expect(second).toBe(first);
    expect(new ConfigService({ profile: 'org115-emp41', homeDir: tmpHome }).get('agent').hostId).toBe(first);
  });

  it('--profile names the profile; the apiUrl falls back to the install default; an empty modelKeys keeps the env file', async () => {
    writeEnvFile(profileRoot('mine'), { CLAUDE_CODE_OAUTH_TOKEN: 'kept' });
    vi.spyOn(axios, 'post').mockResolvedValue(httpOk(answer({ modelKeys: [] })) as never);
    const r = await runCli(registerAgentCommands, ['agent', 'enroll', TOKEN, '--profile', 'mine']);
    expect(r.exitCode).toBeUndefined();
    const p = new ConfigService({ profile: 'mine', homeDir: tmpHome });
    expect(p.get('apiKey')).toBe(EMPLOYEE_KEY);
    expect(p.get('apiUrl')).toBe(configService.get('apiUrl'));
    expect(fs.readFileSync(path.join(profileRoot('mine'), 'env'), 'utf-8')).toBe('CLAUDE_CODE_OAUTH_TOKEN=kept\n');
    expect(fs.existsSync(profileRoot('org115-emp41'))).toBe(false);
    expect(r.stdout).toContain('good7ob --profile mine agent listen');
  });

  it('the global --profile (GOOD7OB_PROFILE) is honoured too', async () => {
    process.env[PROFILE_ENV] = 'from-global';
    vi.spyOn(axios, 'post').mockResolvedValue(httpOk(answer()) as never);
    await runCli(registerAgentCommands, ['agent', 'enroll', TOKEN]);
    expect(new ConfigService({ profile: 'from-global', homeDir: tmpHome }).get('apiKey')).toBe(EMPLOYEE_KEY);
  });

  it.each([
    ['the uniform invalid-token answer', { status: 200, data: { code: 1007, msg: INVALID_TOKEN } }, INVALID_TOKEN],
    ['an HTTP error without a body', { status: 400, data: '' }, INVALID_TOKEN],
    ['rate limiting', { status: 429, data: '' }, '每分钟最多 10 次'],
  ])('fails cleanly on %s, writing nothing', async (_label, res, message) => {
    vi.spyOn(axios, 'post').mockResolvedValue(res as never);
    const r = await runCli(registerAgentCommands, ['agent', 'enroll', TOKEN]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(message);
    expect(secretsIn(r.stdout + r.stderr)).toEqual([]);
    expect(fs.existsSync(profileRoot('org115-emp41'))).toBe(false);
  });

  it('rejects a malformed token or profile before any request', async () => {
    const post = vi.spyOn(axios, 'post');
    expect((await runCli(registerAgentCommands, ['agent', 'enroll', 'not-a-token'])).stderr).toContain('g7e_');
    expect((await runCli(registerAgentCommands, ['agent', 'enroll', TOKEN, '--profile', '../x'])).stderr).toContain('--profile');
    expect(post).not.toHaveBeenCalled();
  });

  it('an unusable profile name in the answer falls back to org<id>-emp<id> instead of losing the key', async () => {
    const r = await enroll({ token: TOKEN, apiUrl: 'https://x.test', http: async () => httpOk(answer({ profile: '../evil' })) });
    expect(r.profile).toBe('org115-emp41');
    expect(new ConfigService({ profile: 'org115-emp41', homeDir: tmpHome }).get('apiKey')).toBe(EMPLOYEE_KEY);
  });

  it('accepts the design-doc answer shape (employeeId, modelKeys without env)', async () => {
    const r = await enroll({
      token: TOKEN,
      profile: 'd',
      apiUrl: 'https://x.test',
      http: async () => httpOk({ orgId: 7, orgName: 'o', employeeId: 8, employeeName: 'e', key: EMPLOYEE_KEY, modelKeys: [{ provider: 'anthropic', key: MODEL_KEY }, { provider: 'mystery', key: 'x' }] }),
    });
    expect(r).toMatchObject({ aiEmployeeId: 8, aiEmployeeName: 'e', modelKeyEnvs: ['ANTHROPIC_API_KEY'], skippedModelKeys: ['mystery'] });
  });
});
