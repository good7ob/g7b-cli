/**
 * `good7ob setup <token>` (g7b #3633, design 4.2 ③–⑧ / 7.4 / 7.7): one command from a bare machine to a runner that
 * is online as a background service.
 *
 *   1. AI tool      claude → gemini → codex, first that answers `--version`; none: install Claude Code with the
 *                   official installer (asked first, automatic with --yes)
 *   2. enrollment   reuse a profile this token already filled (design 7.7-2), else `agent enroll` (same code)
 *   3. login        a test prompt must answer a fixed text; else login guidance, Enter retries (--yes: fail)
 *   4. forward      Claude: the command enroll wrote; Gemini / Codex: the same structure with their own call
 *   5. MCP          `npx add-mcp` into the profile's work dir, the key referenced as ${GOOD7OB_MCP_KEY}
 *   6. service      test prompt again in the service's environment (design 7.7-4: setup-token / API key fallback),
 *                   install, wait ≤ 60 s for the first heartbeat, print 已上线 and the stop / uninstall commands
 *
 * Enrollment runs before the login test (design order is tool → login → enroll): a hosted token brings the
 * organisation's model key, which the test must already see, and a redeemed token is never wasted because a rerun
 * reuses the profile. Every side effect goes through `SetupDeps`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '../../services/ConfigService';
import { PROFILES_DIR, activeProfile, normalizeProfile, profileDir, readEnvFile, writeEnvFile } from '../../services/profile';
import {
  AGENT_KIND_OF,
  AI_TOOLS,
  AiTool,
  EnrollOptions,
  EnrollResult,
  HOST_PROVIDES_MODEL,
  forwardCommandFor,
  tokenFingerprint,
  validateToken,
} from '../agent/enroll';
import { readListenStatus } from '../agent/listenStatus';
import { KEY_INVALID_MESSAGE } from '../agent/runner';
import { InstallResult, SpecOptions, Sys, controlHints, readConfigFile, serviceRunEnv, tail } from '../service/service';
import { ServiceSpec, serviceLogFile } from '../service/spec';

export const READY_TEXT = 'GOOD7OB_SETUP_OK';
export const TEST_PROMPT = `Reply with exactly this text and nothing else: ${READY_TEXT}`;
export const CLAUDE_INSTALL_SH = 'curl -fsSL https://claude.ai/install.sh | bash';
export const CLAUDE_INSTALL_PS1 = 'irm https://claude.ai/install.ps1 | iex';
/** Pinned so a new add-mcp release cannot change what setup writes. */
export const ADD_MCP = 'add-mcp@2.6.1';
export const MCP_KEY_ENV = 'GOOD7OB_MCP_KEY';
export const HEARTBEAT_TIMEOUT_MS = 60_000;

const TOOL_NAME: Record<AiTool, string> = { claude: 'Claude Code', gemini: 'Gemini CLI', codex: 'Codex' };
/** add-mcp `--agent` ids; Codex is left out (see configureMcp). */
const ADD_MCP_AGENT: Partial<Record<AiTool, string>> = { claude: 'claude-code', gemini: 'gemini-cli' };

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
  /** Hand the terminal to the child (installer output); stdout / stderr are then not captured. */
  inherit?: boolean;
}

export interface SetupIo {
  /** A person can answer (a TTY, or /dev/tty behind `curl | sh`). */
  interactive: boolean;
  /** One line; null when nobody can answer (EOF / not interactive). */
  ask(question: string): Promise<string | null>;
  /** Same, without echoing what is typed. */
  askSecret(question: string): Promise<string | null>;
  log(message: string): void;
  warn(message: string): void;
  /** Release the terminal (an opened /dev/tty). */
  close?(): void;
}

export interface SetupDeps {
  io: SetupIo;
  exec(cmd: string, args: string[], o?: ExecOptions): Promise<ExecResult>;
  which(cmd: string, pathEnv: string, extraDirs?: string[]): string | undefined;
  enroll(o: EnrollOptions): Promise<EnrollResult>;
  sys: Sys;
  buildSpec(o: SpecOptions): ServiceSpec;
  installService(spec: ServiceSpec, sys: Sys): InstallResult;
  sleep(ms: number): Promise<void>;
  now(): number;
  env: NodeJS.ProcessEnv;
  home: string;
  /** Directory of the running node (npx sits next to it). */
  nodeDir: string;
}

export interface SetupOptions {
  token: string;
  apiUrl?: string;
  profile?: string;
  yes?: boolean;
  agent?: AiTool;
  /** false = skip the MCP step (`--no-mcp`). */
  mcp?: boolean;
  /** false = do not install the service (`--no-service`), e.g. a container running listen in the foreground. */
  service?: boolean;
  heartbeatTimeoutMs?: number;
}

export interface SetupResult {
  tool: AiTool;
  profile: string;
  profileDir: string;
  reused: boolean;
  mcp: 'configured' | 'skipped' | 'failed';
  online: boolean;
}

/** A failure the wizard explains itself; the command prints it and exits 1. */
export class SetupError extends Error {}

export function parseAgent(raw: unknown): AiTool {
  const v = String(raw ?? '').trim().toLowerCase();
  if ((AI_TOOLS as readonly string[]).includes(v)) return v as AiTool;
  throw new SetupError(`--agent 只能是 ${AI_TOOLS.join(' / ')}，收到: ${raw}`);
}

export function testArgs(tool: AiTool): string[] {
  return tool === 'codex' ? ['exec', '--skip-git-repo-check', TEST_PROMPT] : ['-p', TEST_PROMPT];
}

/** Dirs searched besides PATH: where the official Claude Code installer puts `claude`. */
export function extraToolDirs(home: string): string[] {
  return [path.join(home, '.local', 'bin')];
}

async function confirm(d: SetupDeps, o: SetupOptions, question: string): Promise<boolean> {
  if (o.yes) return true;
  if (!d.io.interactive) return false;
  const a = (await d.io.ask(`${question} [Y/n] `))?.trim().toLowerCase();
  return a !== null && a !== undefined && (a === '' || a === 'y' || a === 'yes');
}

// ---------------------------------------------------------------- 1. AI tool

export async function findTool(d: SetupDeps, only?: AiTool): Promise<{ tool: AiTool; bin: string } | undefined> {
  for (const tool of only ? [only] : AI_TOOLS) {
    const bin = d.which(tool, d.env.PATH ?? '', extraToolDirs(d.home));
    if (!bin) continue;
    const r = await d.exec(bin, ['--version'], { timeoutMs: 30_000 });
    if (r.code === 0) return { tool, bin };
  }
  return undefined;
}

export async function ensureTool(d: SetupDeps, o: SetupOptions): Promise<{ tool: AiTool; bin: string }> {
  const found = await findTool(d, o.agent);
  if (found) {
    d.io.log(`✓ AI 工具: ${TOOL_NAME[found.tool]}（${found.bin}）`);
    return found;
  }
  if (o.agent && o.agent !== 'claude') {
    throw new SetupError(`未找到可用的 ${TOOL_NAME[o.agent]}。本期只自动安装 Claude Code：请先自行安装并登录 ${o.agent}，或去掉 --agent`);
  }
  const win = d.sys.os === 'win32';
  const installer = win ? CLAUDE_INSTALL_PS1 : CLAUDE_INSTALL_SH;
  d.io.log(o.agent ? '未找到 Claude Code。' : '本机没有找到 Claude Code、Gemini CLI 或 Codex。');
  if (!(await confirm(d, o, `用官方安装器安装 Claude Code？（${installer}）`))) {
    throw new SetupError(`没有可用的 AI 工具。请先安装 Claude Code（${installer}），或加 --yes 让 setup 自动安装，然后重跑 good7ob setup`);
  }
  d.io.log(`正在安装 Claude Code：${installer}`);
  const r = win
    ? await d.exec('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', installer], { inherit: true, timeoutMs: 15 * 60_000 })
    : await d.exec('bash', ['-c', installer], { inherit: true, timeoutMs: 15 * 60_000 });
  if (r.code !== 0) throw new SetupError(`Claude Code 安装失败（退出码 ${r.code}）。可以手动运行 ${installer} 后重跑 good7ob setup`);
  const installed = await findTool(d, 'claude');
  if (!installed) throw new SetupError(`安装器已运行，但没有找到可用的 claude 命令（已查找 PATH 和 ${extraToolDirs(d.home).join(', ')}）`);
  d.io.log(`✓ 已安装 Claude Code（${installed.bin}）`);
  return installed;
}

// ---------------------------------------------------------------- 2. enrollment

export interface Enrollment {
  profile: string;
  profileDir: string;
  apiUrl: string;
  orgName: string;
  employeeName: string;
  hostProvidesModel: boolean;
  reused: boolean;
}

/**
 * The profile this token already filled: the named one (`--profile`) or any under ~/.good7ob-profiles whose
 * `enrollment.tokenSha256` matches and that still holds a key. Read-only, creates nothing.
 */
export function findEnrolledProfile(home: string, token: string, explicit?: string): Enrollment | undefined {
  const fp = tokenFingerprint(token);
  let names: string[];
  if (explicit) names = [explicit];
  else {
    try {
      names = fs.readdirSync(path.join(home, PROFILES_DIR)).sort();
    } catch {
      return undefined;
    }
  }
  for (const name of names) {
    let dir: string;
    try {
      dir = profileDir(name, home);
    } catch {
      continue; // not a profile name (host-id file etc.)
    }
    const cfg = readConfigFile(dir);
    if (!cfg.apiKey || cfg.enrollment?.tokenSha256 !== fp) continue;
    return {
      profile: normalizeProfile(name),
      profileDir: dir,
      apiUrl: String(cfg.apiUrl ?? ''),
      orgName: String(cfg.enrollment?.orgName ?? ''),
      employeeName: String(cfg.enrollment?.aiEmployeeName ?? ''),
      hostProvidesModel: cfg.enrollment?.hostProvidesModel === true,
      reused: true,
    };
  }
  return undefined;
}

export async function ensureEnrollment(d: SetupDeps, o: SetupOptions, tool: AiTool): Promise<Enrollment> {
  const token = validateToken(o.token);
  const explicit = o.profile !== undefined ? normalizeProfile(o.profile) : activeProfile(d.env);
  const existing = findEnrolledProfile(d.home, token, explicit);
  if (existing) {
    d.io.log(`✓ 复用已接入的配置档 ${existing.profile}（这个令牌已经兑换过，不再重复兑换）`);
    return existing;
  }
  const r = await d.enroll({
    token,
    profile: explicit,
    apiUrl: o.apiUrl,
    agentKind: AGENT_KIND_OF[tool],
    forward: tool === 'claude',
    home: d.home,
  });
  d.io.log(`✓ 已接入：${r.aiEmployeeName || `AI 员工 #${r.aiEmployeeId}`}（组织 ${r.orgName || `#${r.orgId}`}），配置档 ${r.profile}，Key 已写入（不显示）`);
  if (r.modelKeyEnvs.length) d.io.log(`  模型 Key 已写入配置档 env 文件（${r.modelKeyEnvs.join(', ')}，不显示）`);
  return {
    profile: r.profile,
    profileDir: r.profileDir,
    apiUrl: r.apiUrl,
    orgName: r.orgName,
    employeeName: r.aiEmployeeName,
    hostProvidesModel: r.hostProvidesModel,
    reused: false,
  };
}

// ---------------------------------------------------------------- 3. login / test prompt

export async function promptWorks(d: SetupDeps, bin: string, tool: AiTool, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail: string }> {
  const r = await d.exec(bin, testArgs(tool), { env, cwd: d.home, timeoutMs: 180_000 });
  if (r.code === 0 && r.stdout.includes(READY_TEXT)) return { ok: true, detail: '' };
  const out = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 300);
  return { ok: false, detail: `退出码 ${r.code}${out ? `：${out}` : ''}` };
}

export function loginGuide(tool: AiTool): string {
  if (tool === 'claude') {
    return [
      `Claude Code 还不能用（测试指令没有返回 ${READY_TEXT}）。任选一种方式：`,
      '  1. 在另一个终端运行 claude，按提示在浏览器里登录（已在 claude 里的话输入 /login）',
      '  2. 运行 claude setup-token 生成长期令牌（sk-ant-oat…），粘贴到这里，写入配置档的 env 文件',
      '  3. 使用 API Key：把 ANTHROPIC_API_KEY（sk-ant-api…）粘贴到这里',
    ].join('\n');
  }
  if (tool === 'gemini') return `Gemini CLI 还不能用（测试指令没有返回 ${READY_TEXT}）。请在另一个终端运行 gemini 按提示登录（或设置 GEMINI_API_KEY）。`;
  return `Codex 还不能用（测试指令没有返回 ${READY_TEXT}）。请在另一个终端运行 codex login 登录（或设置 OPENAI_API_KEY）。`;
}

/** A pasted Claude credential → its env name: setup-token output or an API key; anything else is refused. */
export function credentialEnv(value: string): 'CLAUDE_CODE_OAUTH_TOKEN' | 'ANTHROPIC_API_KEY' | undefined {
  const v = value.trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{8,}$/.test(v)) return undefined;
  return v.startsWith('sk-ant-oat') ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY';
}

function saveCredential(d: SetupDeps, dir: string, value: string): boolean {
  const name = credentialEnv(value);
  if (!name) {
    d.io.warn('无法识别：令牌应以 sk-ant-oat 开头（claude setup-token），API Key 以 sk-ant- 开头');
    return false;
  }
  writeEnvFile(dir, { [name]: value.trim() });
  d.io.log(`  已写入 ${path.join(dir, 'env')}（${name}，不显示）`);
  return true;
}

const rerunHint = (profile: string) => `完成后重跑同一条 good7ob setup 命令（配置档 ${profile} 已兑换，会直接复用）`;

export async function ensureLogin(d: SetupDeps, o: SetupOptions, tool: AiTool, bin: string, e: Enrollment): Promise<void> {
  if (e.hostProvidesModel) d.io.warn(`! ${HOST_PROVIDES_MODEL}`);
  for (;;) {
    const r = await promptWorks(d, bin, tool, { ...d.env, ...readEnvFile(e.profileDir) });
    if (r.ok) {
      d.io.log(`✓ ${TOOL_NAME[tool]} 已登录，测试指令通过`);
      return;
    }
    d.io.warn(`${loginGuide(tool)}\n  （${r.detail}）`);
    if (o.yes || !d.io.interactive) throw new SetupError(`${TOOL_NAME[tool]} 未登录。${rerunHint(e.profile)}`);
    const answer =
      tool === 'claude'
        ? await d.io.askSecret('登录后按回车重试，或粘贴令牌 / API Key（输入 q 退出）: ')
        : await d.io.ask('登录后按回车重试（输入 q 退出）: ');
    if (answer === null || answer.trim().toLowerCase() === 'q') throw new SetupError(`已退出。${rerunHint(e.profile)}`);
    if (tool === 'claude' && answer.trim()) saveCredential(d, e.profileDir, answer);
  }
}

// ---------------------------------------------------------------- 4. forward command

/** Writes the tool's forward template unless the profile has a webhook or a hand-written command. */
export function configureForward(d: SetupDeps, e: Enrollment, tool: AiTool): 'written' | 'kept' {
  const cfg = new ConfigService({ profile: e.profile, homeDir: d.home });
  const agent: Record<string, any> = { ...(cfg.get('agent') ?? {}) };
  const fwd = agent.forward ?? {};
  const want = forwardCommandFor(tool, e.profileDir);
  const ours = !fwd.command || AI_TOOLS.some((t) => fwd.command === forwardCommandFor(t, e.profileDir));
  if (fwd.url || !ours) {
    d.io.log(`✓ 保留已配置的${fwd.url ? ' webhook ' : '自定义'}转发（good7ob --profile ${e.profile} config get agent 可查看）`);
    return 'kept';
  }
  if (fwd.command !== want || agent.agentKind !== AGENT_KIND_OF[tool]) {
    cfg.update({ agent: { ...agent, agentKind: AGENT_KIND_OF[tool], forward: { ...fwd, command: want } } });
  }
  d.io.log(`✓ 转发命令: ${TOOL_NAME[tool]} 模板（日志写到 ${path.join(e.profileDir, 'runs')}）`);
  return 'written';
}

// ---------------------------------------------------------------- 5. MCP

/**
 * good7ob's MCP is the backend's `POST <api>/mcp` (JSON-RPC, `Authorization: Bearer <employee key>`). add-mcp writes
 * it into the profile's work dir (project scope: `.mcp.json` / `.gemini/settings.json`), so profiles never share an
 * entry, and the header refers to ${GOOD7OB_MCP_KEY}, which `agent listen` sets from the profile's key: no config
 * file holds the key. Codex cannot expand variables in headers, so it is skipped. Failure never stops setup.
 */
export async function configureMcp(d: SetupDeps, e: Enrollment, tool: AiTool): Promise<'configured' | 'skipped' | 'failed'> {
  const agent = ADD_MCP_AGENT[tool];
  if (!agent) {
    d.io.log('- 跳过 MCP：Codex 的配置不能在请求头里引用环境变量（执行设备通过 good7ob 命令工作，不受影响）');
    return 'skipped';
  }
  const apiUrl = e.apiUrl.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(apiUrl)) {
    d.io.warn('! 跳过 MCP：配置档里没有 API 地址');
    return 'skipped';
  }
  const work = path.join(e.profileDir, 'work');
  fs.mkdirSync(work, { recursive: true });
  const npxName = d.sys.os === 'win32' ? 'npx.cmd' : 'npx';
  const local = path.join(d.nodeDir, npxName);
  const npx = fs.existsSync(local) ? local : npxName;
  const args = ['-y', ADD_MCP, `${apiUrl}/mcp`, '--name', 'good7ob', '-a', agent, '-y', '--header', `Authorization: Bearer \${${MCP_KEY_ENV}}`];
  const r = await d.exec(npx, args, { cwd: work, timeoutMs: 180_000 });
  if (r.code !== 0) {
    d.io.warn(`! MCP 配置失败（不影响执行任务）: ${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-2).join(' | ').slice(0, 300)}`);
    return 'failed';
  }
  d.io.log(`✓ 已把 good7ob MCP 接入 ${TOOL_NAME[tool]}（${work}，鉴权引用 ${MCP_KEY_ENV}）`);
  return 'configured';
}

// ---------------------------------------------------------------- 6. service

/**
 * Design 7.7-4: the test prompt in the service's own environment (its PATH, HOME, the env file — nothing from the
 * login shell). For Claude: copy a CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY of this shell into the env file,
 * else ask for a `claude setup-token` token (or an API key) until it works.
 */
export async function servicePreflight(d: SetupDeps, o: SetupOptions, tool: AiTool, e: Enrollment, spec: ServiceSpec): Promise<void> {
  const bin = d.which(tool, spec.env.PATH ?? '');
  if (!bin) throw new SetupError(`后台服务的 PATH 里找不到 ${tool}（PATH=${spec.env.PATH}）`);
  let copied = false;
  for (;;) {
    const r = await promptWorks(d, bin, tool, serviceRunEnv(spec));
    if (r.ok) {
      d.io.log(`✓ 后台服务环境下 ${TOOL_NAME[tool]} 可用`);
      return;
    }
    if (tool !== 'claude') {
      throw new SetupError(`${TOOL_NAME[tool]} 在终端里可用，但在后台服务环境下不可用（${r.detail}）。请用 API Key 方式登录后重跑 good7ob setup`);
    }
    if (!copied) {
      copied = true;
      const fileEnv = readEnvFile(e.profileDir);
      const fromShell = (['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'] as const).filter((k) => d.env[k] && !fileEnv[k]);
      if (fromShell.length) {
        writeEnvFile(e.profileDir, Object.fromEntries(fromShell.map((k) => [k, String(d.env[k])])));
        d.io.log(`  后台服务读不到当前终端的环境变量：已把 ${fromShell.join(', ')} 写入配置档 env 文件（不显示），重试`);
        continue;
      }
    }
    d.io.warn(
      [
        `后台服务读不到 Claude Code 的登录状态（${r.detail}）。`,
        '请在另一个终端运行 claude setup-token，把生成的令牌（sk-ant-oat…）粘贴到这里；也可以粘贴 ANTHROPIC_API_KEY。',
        `令牌写入 ${path.join(e.profileDir, 'env')}（CLAUDE_CODE_OAUTH_TOKEN），只有后台服务使用。`,
      ].join('\n')
    );
    if (o.yes || !d.io.interactive) {
      throw new SetupError(`后台服务环境下 Claude Code 不可用。运行 claude setup-token 后，带上 CLAUDE_CODE_OAUTH_TOKEN=<令牌> 重跑 good7ob setup（会写进配置档）`);
    }
    const answer = await d.io.askSecret('粘贴令牌 / API Key（输入 q 退出）: ');
    if (answer === null || answer.trim().toLowerCase() === 'q') throw new SetupError(`已退出。${rerunHint(e.profile)}`);
    if (answer.trim()) saveCredential(d, e.profileDir, answer);
  }
}

/** Waits for a heartbeat newer than `sinceMs` in listen-status.json; a rejected key ends the wait at once. */
export async function waitForHeartbeat(d: SetupDeps, dir: string, sinceMs: number, timeoutMs: number): Promise<'online' | 'key-invalid' | 'timeout'> {
  const deadline = sinceMs + timeoutMs;
  for (;;) {
    const st = readListenStatus(dir);
    if (st.keyInvalidAt && Date.parse(st.keyInvalidAt) >= sinceMs) return 'key-invalid';
    if (st.lastBeatAt && Date.parse(st.lastBeatAt) >= sinceMs) return 'online';
    if (d.now() >= deadline) return 'timeout';
    await d.sleep(2000);
  }
}

// ---------------------------------------------------------------- all steps

export async function runSetup(o: SetupOptions, d: SetupDeps): Promise<SetupResult> {
  validateToken(o.token);
  const { tool, bin } = await ensureTool(d, o);
  const e = await ensureEnrollment(d, o, tool);
  await ensureLogin(d, o, tool, bin, e);
  configureForward(d, e, tool);
  const mcp = o.mcp === false ? 'skipped' : await configureMcp(d, e, tool);
  const base = { tool, profile: e.profile, profileDir: e.profileDir, reused: e.reused, mcp } as const;
  if (o.service === false) {
    d.io.log(`✓ 配置完成（未安装后台服务）。前台运行: good7ob --profile ${e.profile} agent listen`);
    return { ...base, online: false };
  }

  const spec = d.buildSpec({ profile: e.profile, os: d.sys.os, home: d.home });
  await servicePreflight(d, o, tool, e, spec);
  const since = d.now();
  d.installService(spec, d.sys);
  const hints = controlHints(spec, d.sys.uid);
  d.io.log(`✓ 已安装后台服务，等待第一次心跳（最多 ${Math.round((o.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS) / 1000)} 秒）…`);
  const outcome = await waitForHeartbeat(d, e.profileDir, since, o.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS);
  if (outcome !== 'online') {
    const log = tail(serviceLogFile(spec), 5).map((l) => `    ${l}`);
    const why = outcome === 'key-invalid' ? `${KEY_INVALID_MESSAGE}：请在网页上重新生成令牌后运行 good7ob setup <新令牌>` : '60 秒内没有收到心跳';
    throw new SetupError([why, `  查看: ${hints.status}`, ...(log.length ? ['  最近日志:', ...log] : [])].join('\n'));
  }
  d.io.log(
    [
      `✓ 已上线：${e.employeeName || 'AI 员工'}${e.orgName ? `（组织 ${e.orgName}）` : ''}，配置档 ${e.profile}`,
      `  状态: ${hints.status}`,
      `  停用: ${hints.stop}`,
      `  卸载: ${hints.uninstall}`,
    ].join('\n')
  );
  return { ...base, online: true };
}
