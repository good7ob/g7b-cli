import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../../../services/ConfigService';
import { PROFILE_ENV, readEnvFile, writeEnvFile } from '../../../services/profile';
import { EnrollOptions, RedeemHttp, defaultForwardCommand, enroll, forwardCommandFor, tokenFingerprint } from '../../agent/enroll';
import { updateListenStatus } from '../../agent/listenStatus';
import { RunResult, Sys, buildSpec } from '../../service/service';
import {
  ADD_MCP,
  ExecOptions,
  READY_TEXT,
  SetupDeps,
  SetupError,
  SetupOptions,
  configureForward,
  configureMcp,
  credentialEnv,
  ensureEnrollment,
  ensureLogin,
  ensureTool,
  findEnrolledProfile,
  parseAgent,
  runSetup,
  servicePreflight,
  testArgs,
  waitForHeartbeat,
} from '../wizard';
import { registerSetupCommands } from '../index';
import { runCli } from '../../../utils/__tests__/cliHarness';

vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as typeof import('os');
  const homedir = () => '/nonexistent-test-home';
  return { ...actual, default: { ...actual, homedir }, homedir };
});

const TOKEN = 'g7e_' + 'B'.repeat(43);
const EMPLOYEE_KEY = 'g7b_sk_SECRET_EMPLOYEE_KEY_0123456789';
const answer = (over: Record<string, unknown> = {}) => ({
  status: 200,
  data: { code: 200, data: { orgId: 115, orgName: '远见科技', aiEmployeeId: 41, aiEmployeeName: '开发助理', profile: 'org115-emp41', key: EMPLOYEE_KEY, modelKeys: [], ...over } },
});

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-'));
  delete process.env[PROFILE_ENV];
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

type ExecFn = (cmd: string, args: string[], o: ExecOptions) => RunResult | Promise<RunResult>;
const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });
const READY = ok(`${READY_TEXT}\n`);

interface Harness extends SetupDeps {
  out: string[];
  err: string[];
  calls: { cmd: string; args: string[]; o: ExecOptions }[];
  answers: (string | null)[];
  sysCalls: string[];
  installed: number;
}

/**
 * Mocked machine: `tools` = names on PATH (bin = /bin/<name>), `exec` answers every process, `answers` feeds
 * ask / askSecret in order, the redeem goes through the real enroll with a mocked HTTP layer.
 */
function harness(o: { tools?: string[]; exec?: ExecFn; answers?: (string | null)[]; interactive?: boolean; http?: RedeemHttp; osName?: Sys['os'] } = {}): Harness {
  const tools = new Set(o.tools ?? ['claude']);
  const h: Partial<Harness> = {};
  const out: string[] = [];
  const err: string[] = [];
  const calls: Harness['calls'] = [];
  const answers = [...(o.answers ?? [])];
  const sysCalls: string[] = [];
  let clock = Date.parse('2026-11-22T00:00:00Z');
  const sys: Sys = {
    os: o.osName ?? 'darwin',
    uid: 501,
    run: (cmd, args) => {
      sysCalls.push([cmd, ...args].join(' '));
      return ok();
    },
  };
  const http: RedeemHttp = o.http ?? (async () => answer());
  Object.assign(h, {
    out,
    err,
    calls,
    answers,
    sysCalls,
    installed: 0,
    io: {
      interactive: o.interactive ?? true,
      ask: async () => (answers.length ? answers.shift()! : null),
      askSecret: async () => (answers.length ? answers.shift()! : null),
      log: (m: string) => out.push(m),
      warn: (m: string) => err.push(m),
    },
    exec: async (cmd: string, args: string[], eo: ExecOptions = {}) => {
      calls.push({ cmd, args, o: eo });
      if (args[0] === '--version') return ok('1.0.0');
      return o.exec ? o.exec(cmd, args, eo) : READY;
    },
    which: (cmd: string) => (tools.has(cmd) ? `/bin/${cmd}` : undefined),
    enroll: (eo: EnrollOptions) => enroll({ ...eo, http, pathEnv: '/bin' }),
    sys,
    buildSpec: (so: Parameters<typeof buildSpec>[0]) =>
      buildSpec({ ...so, nodePath: '/n/bin/node', cliEntry: '/c/index.js', pathEnv: '/bin', toolPaths: ['/bin/claude'] }),
    installService: () => {
      (h as Harness).installed++;
    },
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    env: { PATH: '/bin' } as NodeJS.ProcessEnv,
    home,
    nodeDir: '/n/bin',
  });
  return h as Harness;
}

const opts = (over: Partial<SetupOptions> = {}): SetupOptions => ({ token: TOKEN, apiUrl: 'https://api-dev.good7ob.net', ...over });
const profileDir = (name = 'org115-emp41') => path.join(home, '.good7ob-profiles', name);

describe('step 1: AI tool', () => {
  it('takes the first usable tool in the order claude → gemini → codex', async () => {
    const h = harness({ tools: ['codex', 'gemini'] });
    expect(await ensureTool(h, opts())).toEqual({ tool: 'gemini', bin: '/bin/gemini' });
    expect(h.calls.map((c) => `${c.cmd} ${c.args.join(' ')}`)).toEqual(['/bin/gemini --version']);
  });

  it('skips a tool whose --version fails', async () => {
    const h = harness({ tools: ['claude', 'codex'] });
    const base = h.exec;
    h.exec = async (cmd, args, o) => (cmd === '/bin/claude' ? { code: 1, stdout: '', stderr: 'broken' } : base(cmd, args, o));
    expect((await ensureTool(h, opts())).tool).toBe('codex');
  });

  it('--agent picks one tool; a missing gemini / codex is not installed', async () => {
    expect((await ensureTool(harness({ tools: ['claude', 'codex'] }), opts({ agent: 'codex' }))).tool).toBe('codex');
    await expect(ensureTool(harness({ tools: ['claude'] }), opts({ agent: 'gemini' }))).rejects.toThrow(/本期只自动安装 Claude Code/);
  });

  it('no tool: --yes runs the official installer, then finds claude', async () => {
    const tools = new Set<string>();
    const h = harness({ tools: [] });
    h.which = (cmd) => (tools.has(cmd) ? `/home/.local/bin/${cmd}` : undefined);
    h.exec = async (cmd, args, o) => {
      h.calls.push({ cmd, args, o: o ?? {} });
      if (cmd === 'bash') tools.add('claude');
      return ok();
    };
    expect(await ensureTool(h, opts({ yes: true }))).toEqual({ tool: 'claude', bin: '/home/.local/bin/claude' });
    expect(h.calls[0]).toMatchObject({ cmd: 'bash', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'], o: { inherit: true } });
  });

  it('no tool: asks first; "n" or no terminal refuses without installing', async () => {
    const h = harness({ tools: [], answers: ['n'] });
    await expect(ensureTool(h, opts())).rejects.toThrow(/没有可用的 AI 工具/);
    const h2 = harness({ tools: [], interactive: false });
    await expect(ensureTool(h2, opts())).rejects.toThrow(/加 --yes/);
    expect([...h.calls, ...h2.calls].some((c) => c.cmd === 'bash')).toBe(false);
  });

  it('Windows uses the PowerShell installer', async () => {
    const h = harness({ tools: [], osName: 'win32', answers: [''] });
    h.exec = async (cmd, args, o) => {
      h.calls.push({ cmd, args, o: o ?? {} });
      return { code: 1, stdout: '', stderr: '' };
    };
    await expect(ensureTool(h, opts())).rejects.toThrow(/安装失败/);
    expect(h.calls[0].cmd).toBe('powershell');
    expect(h.calls[0].args).toContain('irm https://claude.ai/install.ps1 | iex');
  });

  it('parseAgent', () => {
    expect(parseAgent('Gemini')).toBe('gemini');
    expect(() => parseAgent('cursor')).toThrow(SetupError);
  });
});

describe('step 2: enrollment', () => {
  it('redeems through agent enroll, stores the token fingerprint, and reuses the profile on a rerun (design 7.7-2)', async () => {
    let redeems = 0;
    const h = harness({ http: async () => (redeems++, answer()) });
    const e = await ensureEnrollment(h, opts(), 'claude');
    expect(e).toMatchObject({ profile: 'org115-emp41', reused: false, orgName: '远见科技', employeeName: '开发助理' });
    const cfg = new ConfigService({ profile: 'org115-emp41', homeDir: home });
    expect(cfg.get('enrollment').tokenSha256).toBe(tokenFingerprint(TOKEN));
    expect(cfg.get('agent').forward.command).toBe(defaultForwardCommand(profileDir()));
    expect(h.out.join('\n')).not.toContain(EMPLOYEE_KEY);

    const again = await ensureEnrollment(harness({ http: async () => (redeems++, answer()) }), opts(), 'claude');
    expect(again).toMatchObject({ profile: 'org115-emp41', reused: true });
    expect(redeems).toBe(1);
  });

  it('a different token redeems again (re-enrollment after the key was revoked)', async () => {
    let redeems = 0;
    const http: RedeemHttp = async () => (redeems++, answer());
    await ensureEnrollment(harness({ http }), opts(), 'claude');
    await ensureEnrollment(harness({ http }), opts({ token: 'g7e_' + 'C'.repeat(43) }), 'claude');
    expect(redeems).toBe(2);
  });

  it('finds the profile by fingerprint only when it still has a key', () => {
    const dir = profileDir('x1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: '', enrollment: { tokenSha256: tokenFingerprint(TOKEN) } }));
    expect(findEnrolledProfile(home, TOKEN)).toBeUndefined();
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ apiKey: 'k', enrollment: { tokenSha256: tokenFingerprint(TOKEN), hostProvidesModel: true } }));
    expect(findEnrolledProfile(home, TOKEN)).toMatchObject({ profile: 'x1', hostProvidesModel: true });
    expect(findEnrolledProfile(home, TOKEN, 'other')).toBeUndefined();
  });

  it('sends the tool\'s agentKind; gemini gets no Claude default from enroll', async () => {
    const bodies: any[] = [];
    const h = harness({ http: async (_u, b) => (bodies.push(b), answer()) });
    await ensureEnrollment(h, opts(), 'gemini');
    expect(bodies[0].agentKind).toBe('GEMINI_CLI');
    expect(new ConfigService({ profile: 'org115-emp41', homeDir: home }).get('agent').forward).toBeUndefined();
  });

  it('hostProvidesModel is kept from the answer', async () => {
    const e = await ensureEnrollment(harness({ http: async () => answer({ hostProvidesModel: true }) }), opts(), 'claude');
    expect(e.hostProvidesModel).toBe(true);
  });
});

const enrollment = (over = {}) => ({
  profile: 'org115-emp41',
  profileDir: profileDir(),
  apiUrl: 'https://api-dev.good7ob.net',
  orgName: '远见科技',
  employeeName: '开发助理',
  hostProvidesModel: false,
  reused: false,
  ...over,
});

describe('step 3: login check', () => {
  it('passes when the test prompt returns the fixed text; the env file is visible to it', async () => {
    writeEnvFile(profileDir(), { ANTHROPIC_API_KEY: 'sk-ant-api-xxxxxxxxxxxx' });
    const h = harness();
    await ensureLogin(h, opts(), 'claude', '/bin/claude', enrollment());
    expect(h.calls[0]).toMatchObject({ cmd: '/bin/claude', args: testArgs('claude') });
    expect(h.calls[0].o.env?.ANTHROPIC_API_KEY).toBe('sk-ant-api-xxxxxxxxxxxx');
    expect(testArgs('codex')).toEqual(['exec', '--skip-git-repo-check', expect.stringContaining(READY_TEXT)]);
  });

  it('hostProvidesModel=true: says the machine needs its own model login', async () => {
    const h = harness();
    await ensureLogin(h, opts(), 'claude', '/bin/claude', enrollment({ hostProvidesModel: true }));
    expect(h.err.join('\n')).toContain('本机需自备模型凭证');
  });

  it('--yes fails with the login guidance instead of waiting', async () => {
    const h = harness({ exec: () => ({ code: 1, stdout: 'Invalid API key · Please run /login', stderr: '' }) });
    await expect(ensureLogin(h, opts({ yes: true }), 'claude', '/bin/claude', enrollment())).rejects.toThrow(/Claude Code 未登录/);
    const guide = h.err.join('\n');
    expect(guide).toContain('claude setup-token');
    expect(guide).toContain('ANTHROPIC_API_KEY');
    expect(guide).toContain('Invalid API key');
  });

  it('interactive: Enter retries; a pasted setup-token goes to the env file as CLAUDE_CODE_OAUTH_TOKEN', async () => {
    let n = 0;
    const h = harness({
      answers: ['', 'sk-ant-oat01-abcdefghijk'],
      exec: (_c, _a, o) => (++n === 3 && o.env?.CLAUDE_CODE_OAUTH_TOKEN ? READY : { code: 1, stdout: '', stderr: 'not logged in' }),
    });
    await ensureLogin(h, opts(), 'claude', '/bin/claude', enrollment());
    expect(n).toBe(3);
    expect(readEnvFile(profileDir())).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-abcdefghijk' });
    expect(h.out.join('\n')).not.toContain('sk-ant-oat01-abcdefghijk');
  });

  it('q quits', async () => {
    const h = harness({ answers: ['q'], exec: () => ({ code: 1, stdout: '', stderr: '' }) });
    await expect(ensureLogin(h, opts(), 'gemini', '/bin/gemini', enrollment())).rejects.toThrow(/已退出/);
    expect(h.err.join('\n')).toContain('运行 gemini 按提示登录');
  });

  it('credentialEnv', () => {
    expect(credentialEnv('sk-ant-oat01-abcdefgh')).toBe('CLAUDE_CODE_OAUTH_TOKEN');
    expect(credentialEnv(' sk-ant-api03-abcdefgh ')).toBe('ANTHROPIC_API_KEY');
    expect(credentialEnv('hello')).toBeUndefined();
  });
});

describe('step 4: forward command', () => {
  const setAgent = (agent: Record<string, unknown>) => new ConfigService({ profile: 'org115-emp41', homeDir: home }).update({ apiKey: 'k', agent });
  const agentOf = () => new ConfigService({ profile: 'org115-emp41', homeDir: home }).get('agent');

  it('gemini / codex templates share the claude structure', () => {
    const g = forwardCommandFor('gemini', profileDir());
    const c = forwardCommandFor('codex', profileDir());
    for (const cmd of [g, c]) {
      expect(cmd).toMatch(/^mkdir -p '.*\/work' '.*\/runs' && cd '.*\/work' && /);
      expect(cmd).toMatch(/> '.*\/runs\/task-\{taskId\}\.log' 2>&1$/);
    }
    expect(g).toContain('gemini -p "');
    expect(g).toContain('--approval-mode auto_edit');
    expect(g).not.toContain('yolo');
    expect(c).toContain('codex exec --skip-git-repo-check --sandbox workspace-write');
    expect(c).toContain(`--add-dir '${profileDir()}'`);
  });

  it('writes the template for the chosen tool and switches a template written before', () => {
    setAgent({ agentKind: 'CLAUDE_CODE', forward: { command: defaultForwardCommand(profileDir()) } });
    expect(configureForward(harness(), enrollment(), 'gemini')).toBe('written');
    expect(agentOf()).toMatchObject({ agentKind: 'GEMINI_CLI', forward: { command: forwardCommandFor('gemini', profileDir()) } });
  });

  it('keeps a hand-written command or a webhook', () => {
    setAgent({ forward: { command: 'my-agent {taskId}' } });
    expect(configureForward(harness(), enrollment(), 'claude')).toBe('kept');
    expect(agentOf().forward.command).toBe('my-agent {taskId}');
    setAgent({ forward: { url: 'https://hook', secret: 's' } });
    expect(configureForward(harness(), enrollment(), 'codex')).toBe('kept');
  });
});

describe('step 5: MCP', () => {
  it('runs add-mcp in the profile work dir with the key as ${GOOD7OB_MCP_KEY}', async () => {
    const h = harness({ exec: () => ok('done') });
    expect(await configureMcp(h, enrollment(), 'claude')).toBe('configured');
    const c = h.calls[0];
    expect(c.cmd).toBe('npx');
    expect(c.args).toEqual(['-y', ADD_MCP, 'https://api-dev.good7ob.net/mcp', '--name', 'good7ob', '-a', 'claude-code', '-y', '--header', 'Authorization: Bearer ${GOOD7OB_MCP_KEY}']);
    expect(c.o.cwd).toBe(path.join(profileDir(), 'work'));
    expect(c.args.join(' ')).not.toContain(EMPLOYEE_KEY);
  });

  it('gemini uses gemini-cli; codex is skipped; a failure does not stop setup', async () => {
    const h = harness({ exec: () => ({ code: 1, stdout: '', stderr: 'npm ERR! network' }) });
    expect(await configureMcp(h, enrollment(), 'gemini')).toBe('failed');
    expect(h.calls[0].args).toContain('gemini-cli');
    expect(h.err.join('\n')).toContain('不影响执行任务');
    const h2 = harness();
    expect(await configureMcp(h2, enrollment(), 'codex')).toBe('skipped');
    expect(h2.calls).toEqual([]);
  });
});

describe('step 6: service preflight (design 7.7-4)', () => {
  const spec = (h: Harness) => h.buildSpec({ profile: 'org115-emp41', os: 'darwin', home });

  it('runs the test prompt with the service environment only (no shell variables)', async () => {
    const h = harness();
    h.env = { PATH: '/bin', SHELL_ONLY: 'x' };
    await servicePreflight(h, opts(), 'claude', enrollment(), spec(h));
    const env = h.calls[0].o.env!;
    expect(env.HOME).toBe(home);
    expect(env.GOOD7OB_PROFILE).toBe('org115-emp41');
    expect(env.SHELL_ONLY).toBeUndefined();
  });

  it('copies a token of this shell into the env file and retries', async () => {
    const h = harness({ exec: (_c, _a, o) => (o.env?.CLAUDE_CODE_OAUTH_TOKEN ? READY : { code: 1, stdout: '', stderr: 'login' }) });
    h.env = { PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fromshell' };
    await servicePreflight(h, opts({ yes: true }), 'claude', enrollment(), spec(h));
    expect(readEnvFile(profileDir())).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fromshell' });
  });

  it('asks for a claude setup-token, writes it, retries', async () => {
    const h = harness({
      answers: ['sk-ant-oat01-pasted-token'],
      exec: (_c, _a, o) => (o.env?.CLAUDE_CODE_OAUTH_TOKEN ? READY : { code: 1, stdout: '', stderr: 'keychain' }),
    });
    await servicePreflight(h, opts(), 'claude', enrollment(), spec(h));
    expect(h.err.join('\n')).toContain('claude setup-token');
    expect(readEnvFile(profileDir()).CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-pasted-token');
  });

  it('--yes without a token fails with the setup-token instructions', async () => {
    const h = harness({ exec: () => ({ code: 1, stdout: '', stderr: 'login' }) });
    await expect(servicePreflight(h, opts({ yes: true }), 'claude', enrollment(), spec(h))).rejects.toThrow(/CLAUDE_CODE_OAUTH_TOKEN=<令牌> 重跑/);
  });

  it('a tool missing from the service PATH fails', async () => {
    const h = harness({ tools: [] });
    await expect(servicePreflight(h, opts(), 'claude', enrollment(), spec(h))).rejects.toThrow(/PATH 里找不到 claude/);
  });
});

describe('waiting for the first heartbeat', () => {
  it('online once listen records a beat after the install', async () => {
    const h = harness();
    const since = h.now();
    updateListenStatus(profileDir(), { lastBeatAt: new Date(since - 5000).toISOString() });
    h.sleep = async () => updateListenStatus(profileDir(), { lastBeatAt: new Date(since + 1000).toISOString() });
    expect(await waitForHeartbeat(h, profileDir(), since, 60_000)).toBe('online');
  });

  it('a rejected key stops the wait; no beat for 60 s is a timeout', async () => {
    const h = harness();
    const since = h.now();
    updateListenStatus(profileDir(), { keyInvalidAt: new Date(since + 10).toISOString() });
    expect(await waitForHeartbeat(h, profileDir(), since, 60_000)).toBe('key-invalid');
    const h2 = harness();
    expect(await waitForHeartbeat(h2, profileDir('none'), h2.now(), 60_000)).toBe('timeout');
    expect(h2.now() - Date.parse('2026-11-22T00:00:00Z')).toBe(60_000);
  });
});

describe('runSetup', () => {
  it('runs every step and prints 已上线 with the stop / uninstall commands', async () => {
    const h = harness();
    h.installService = () => {
      h.installed++;
      updateListenStatus(profileDir(), { lastBeatAt: new Date(h.now() + 1).toISOString() });
    };
    const r = await runSetup(opts(), h);
    expect(r).toEqual({ tool: 'claude', profile: 'org115-emp41', profileDir: profileDir(), reused: false, mcp: 'configured', online: true });
    expect(h.installed).toBe(1);
    const out = h.out.join('\n');
    expect(out).toContain('✓ 已上线：开发助理（组织 远见科技），配置档 org115-emp41');
    expect(out).toContain('停用: launchctl bootout gui/501/com.good7ob.runner.org115-emp41');
    expect(out).toContain('卸载: good7ob service uninstall --profile org115-emp41');
    expect(out).not.toContain(EMPLOYEE_KEY);
    // tool check, login test, MCP, service preflight
    expect(h.calls.map((c) => c.cmd)).toEqual(['/bin/claude', '/bin/claude', 'npx', '/bin/claude']);
  });

  it('--no-service --no-mcp stops after the forward command', async () => {
    const h = harness();
    const r = await runSetup(opts({ service: false, mcp: false }), h);
    expect(r).toMatchObject({ online: false, mcp: 'skipped' });
    expect(h.installed).toBe(0);
    expect(h.out.join('\n')).toContain('good7ob --profile org115-emp41 agent listen');
  });

  it('no heartbeat within the limit fails with the status command', async () => {
    const h = harness();
    await expect(runSetup(opts({ mcp: false }), h)).rejects.toThrow(/60 秒内没有收到心跳[\s\S]*good7ob service status --profile org115-emp41/);
  });

  it('a bad token fails before anything runs', async () => {
    const h = harness();
    await expect(runSetup(opts({ token: 'nope' }), h)).rejects.toThrow(/g7e_/);
    expect(h.calls).toEqual([]);
  });
});

describe('good7ob setup (command)', () => {
  it('passes the flags to the wizard and exits 0 when online', async () => {
    const h = harness({ tools: ['claude', 'gemini'] });
    h.installService = () => updateListenStatus(profileDir('mine'), { lastBeatAt: new Date(h.now() + 1).toISOString() });
    const r = await runCli((p) => registerSetupCommands(p, () => h), ['setup', TOKEN, '--api-url', 'https://api-dev.good7ob.net', '--profile', 'mine', '--agent', 'gemini', '--yes', '--no-mcp']);
    expect(r.exitCode).toBeUndefined();
    expect(h.out.join('\n')).toContain('✓ 已上线');
    expect(new ConfigService({ profile: 'mine', homeDir: home }).get('agent').agentKind).toBe('GEMINI_CLI');
    expect(h.calls.some((c) => c.cmd === 'npx')).toBe(false);
  });

  it('a wizard failure prints ✗ and exits 1', async () => {
    const h = harness();
    const r = await runCli((p) => registerSetupCommands(p, () => h), ['setup', TOKEN, '--agent', 'cursor']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('✗ --agent 只能是 claude / gemini / codex');
  });
});
