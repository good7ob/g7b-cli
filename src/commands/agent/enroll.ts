/**
 * `good7ob agent enroll <token>` (g7b #3632, design runner-onboarding 7.2 / 7.7): trade a one-time enrollment
 * token for the AI employee's key and write it into a configuration profile.
 *
 * `POST /api/v1/runner-enrollments/redeem` needs no login (the token is the credential). The key and the model
 * keys in the answer are written to disk only — never printed, never logged, never part of an error message.
 *
 * Host id: one random id per machine data root (`~/.good7ob-profiles/host-id`, `<hostname>-<8 hex>`), copied into
 * the profile as `agent.hostId` so `agent listen` registers the runner under the same id. It is created before the
 * redeem call, so a retry after a lost answer sends the same id (the backend allows one re-redeem from the same host
 * within 15 minutes) even when the profile name is only known from that answer.
 */

import axios from 'axios';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../../services/ConfigService';
import { currentFlavor } from '../../services/flavor';
import { PROFILES_DIR, activeProfile, normalizeProfile, profileDir, writeEnvFile } from '../../services/profile';
import { USER_AGENT } from '../../services/version';
import { InputError } from '../../utils/cliHelpers';
import { validateCommandTemplate } from './forward';
import { DEFAULT_AGENT_KIND, normalizeAgentKind, normalizeHostId } from './runner';

export const REDEEM_PATH = '/api/v1/runner-enrollments/redeem';
/** The backend answers every failed redeem with this one sentence (contract 2.4). */
export const INVALID_TOKEN = '接入令牌无效或已过期，请重新生成';
export const HOST_ID_FILE = 'host-id';

/** provider -> env name, for an answer that only names the provider (design 7.2 shape). */
const PROVIDER_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  google: 'GEMINI_API_KEY',
};
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ModelKey {
  provider?: string;
  env?: string;
  key?: string;
}

export interface Redeemed {
  orgId: number;
  orgName: string;
  aiEmployeeId: number;
  aiEmployeeName: string;
  profile?: string;
  key: string;
  modelKeys: ModelKey[];
}

export interface RedeemBody {
  token: string;
  hostId: string;
  hostName: string;
  agentKind: string;
}

/** POST without the shared ApiClient: no Authorization header, no interceptor printing, the body never echoed. */
export type RedeemHttp = (url: string, body: RedeemBody) => Promise<{ status: number; data: any }>;

const defaultHttp: RedeemHttp = async (url, body) => {
  const res = await axios.post(url, body, {
    timeout: 30_000,
    validateStatus: () => true,
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
  });
  return { status: res.status, data: res.data };
};

export function validateToken(raw: unknown): string {
  const token = String(raw ?? '').trim();
  if (!/^g7e_[A-Za-z0-9_-]{8,256}$/.test(token)) throw new InputError('接入令牌格式不对：应以 g7e_ 开头（从后台或「在我的电脑上运行」页面复制）');
  return token;
}

export function validateApiUrl(raw: unknown): string {
  const url = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/\S+$/.test(url)) throw new InputError(`--api-url 必须是 http(s) 地址，收到: ${raw}`);
  return url;
}

/** `<hostname>-<8 hex>`: readable in the Runners list, unique even for containers sharing an image hostname. */
export function newHostId(hostname = os.hostname(), rand = randomBytes(4).toString('hex')): string {
  const base = hostname.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'host';
  return `${base}-${rand}`;
}

/** The machine's enrollment host id under `home`, created (mode 600) on first use. */
export function machineHostId(home = os.homedir()): string {
  const dir = path.join(home, PROFILES_DIR);
  const file = path.join(dir, HOST_ID_FILE);
  try {
    const existing = fs.readFileSync(file, 'utf-8').trim();
    if (existing) return normalizeHostId(existing, file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const id = newHostId();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${id}\n`, { encoding: 'utf-8', mode: 0o600 });
  return id;
}

const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : NaN);

/** Validates the answer; error messages name the missing field only, never a value. */
export function toRedeemed(data: any): Redeemed {
  const orgId = num(data?.orgId);
  const aiEmployeeId = num(data?.aiEmployeeId ?? data?.employeeId);
  const key = typeof data?.key === 'string' ? data.key.trim() : '';
  if (!key) throw new Error('兑换响应缺少 key');
  if (!(orgId > 0)) throw new Error('兑换响应缺少 orgId');
  if (!(aiEmployeeId > 0)) throw new Error('兑换响应缺少 aiEmployeeId');
  return {
    orgId,
    orgName: String(data?.orgName ?? ''),
    aiEmployeeId,
    aiEmployeeName: String(data?.aiEmployeeName ?? data?.employeeName ?? ''),
    profile: typeof data?.profile === 'string' && data.profile.trim() ? data.profile.trim() : undefined,
    key,
    modelKeys: Array.isArray(data?.modelKeys) ? data.modelKeys : [],
  };
}

export async function redeem(apiUrl: string, body: RedeemBody, http: RedeemHttp = defaultHttp): Promise<Redeemed> {
  let res: { status: number; data: any };
  try {
    res = await http(`${apiUrl}${REDEEM_PATH}`, body);
  } catch (e) {
    // axios' message is the transport error only ("connect ECONNREFUSED …"), never the request body
    const code = (e as { code?: string }).code;
    throw new Error(`无法连接 ${apiUrl}${code ? `（${code}）` : ''}`);
  }
  if (res.status === 429) throw new Error('兑换太频繁（每分钟最多 10 次），请稍后再试');
  const envelope = res.data;
  const code = envelope?.code;
  if (res.status >= 400 || (code != null && code !== 200)) {
    const msg = typeof envelope?.msg === 'string' && envelope.msg ? envelope.msg : res.status >= 500 ? `服务端错误（HTTP ${res.status}）` : INVALID_TOKEN;
    throw new Error(msg);
  }
  return toRedeemed(envelope && typeof envelope === 'object' && 'data' in envelope ? envelope.data : envelope);
}

/** `{ENV: key}` for the env file; entries without a usable env name or key are reported by name and skipped. */
export function modelKeyEnv(keys: ModelKey[]): { values: Record<string, string>; skipped: string[] } {
  const values: Record<string, string> = {};
  const skipped: string[] = [];
  for (const mk of keys) {
    const provider = String(mk?.provider ?? '').trim().toLowerCase();
    const env = mk?.env && ENV_NAME.test(mk.env) ? mk.env : PROVIDER_ENV[provider];
    const key = typeof mk?.key === 'string' ? mk.key.trim() : '';
    if (!env || !key || /[\r\n]/.test(key)) skipped.push(provider || '(unknown)');
    else values[env] = key;
  }
  return { values, skipped };
}

export interface EnrollOptions {
  token: string;
  profile?: string;
  apiUrl?: string;
  agentKind?: string;
  /** false = never write the default forward command (`--no-forward`). */
  forward?: boolean;
  home?: string;
  http?: RedeemHttp;
  /** PATH searched for `claude` (default: process.env.PATH). */
  pathEnv?: string;
}

export interface EnrollResult {
  profile: string;
  profileDir: string;
  apiUrl: string;
  hostId: string;
  orgId: number;
  orgName: string;
  aiEmployeeId: number;
  aiEmployeeName: string;
  /** Names of the env file entries written (values never leave the file). */
  modelKeyEnvs: string[];
  skippedModelKeys: string[];
  forwardConfigured: boolean;
  /** This enroll wrote the default Claude Code forward command. */
  forwardDefaulted: boolean;
  /** Why no default was written although nothing is configured (non-Claude agent kind, unusable path); else undefined. */
  forwardSkipped?: string;
  agentKind: string;
  /** The default command was written but `claude` is not on PATH. */
  claudeMissing: boolean;
}

/** `claude` install hint printed when the default command is written without Claude Code on PATH. */
export const CLAUDE_MISSING = '未找到 claude 命令，请先安装 Claude Code（curl -fsSL https://claude.ai/install.sh | bash）并登录';

/** Whether an executable named `cmd` is on `pathEnv`. */
export function onPath(cmd: string, pathEnv = process.env.PATH ?? ''): boolean {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
  return pathEnv
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) =>
      exts.some((ext) => {
        try {
          fs.accessSync(path.join(dir, cmd + ext), fs.constants.X_OK);
          return fs.statSync(path.join(dir, cmd + ext)).isFile();
        } catch {
          return false;
        }
      })
    );
}

/**
 * Prompt of the default forward command: the generic version of the self-hosted runner prompt (read the task,
 * report steps, decide alone and record it, one `agent done`). Double-quoted in the shell line, so it uses no `"`,
 * `$`, backquote or backslash, and only the {taskId} placeholder.
 * The PR title carries {taskId}, the internal id: the platform links PRs by `g7b #<internal id>`, a taskNo mislinks.
 */
export const DEFAULT_PROMPT = [
  '你是 good7ob AI 员工（执行设备），执行平台任务 {taskId}，当前目录是配置档的 work 目录。',
  '先运行 good7ob pm task get {taskId} --json，读任务说明、验收条件和当前运行步骤的要求，然后按要求完成。',
  '【仓库】以任务或项目开发信息里写的仓库为准，克隆到当前目录下，在新分支上修改，提交 PR，PR 标题以 g7b #{taskId} 开头。',
  '【进度】每完成一小步用 good7ob run 相关命令上报；PR、文档、测试运行等成果按要求上报。',
  "【自主决定】这是无人值守运行，不要停下来等人：需要在几个方案里取舍时，先用 good7ob question create --type choice --source ai --title '<要决定什么>' --option a=<方案A> --option b=<方案B> --description '<背景、各方案代价、推荐理由>' --assignee-employee self --task {taskId} 记录，再用 good7ob question answer <问题ID> --option <你选的> --text '<理由>' 自己确认，然后继续；纯实现细节不用记。",
  '【结束】完成后只运行一次 good7ob agent done {taskId}。',
].join('');

const ALLOWED_TOOLS = '"Bash(good7ob *)" "Bash(git *)" "Bash(gh *)" "Bash(npm *)" "Bash(npx *)" Read Edit Write Glob Grep';

/**
 * `cd <profile>/work && claude -p "<prompt>" --allowedTools … > <profile>/runs/task-{taskId}.log 2>&1`.
 * HOME is left alone (Claude's login lives in the real HOME); the `good7ob` calls inside stay on the profile
 * through the inherited GOOD7OB_PROFILE. Throws for a profile path the single-quoted shell words cannot carry.
 */
export function defaultForwardCommand(dir: string): string {
  if (/['{}\r\n]/.test(dir)) throw new Error(`配置档路径含引号、花括号或换行，无法写入默认转发命令: ${dir}`);
  const work = path.join(dir, 'work');
  const runs = path.join(dir, 'runs');
  const command =
    `mkdir -p '${work}' '${runs}' && cd '${work}' && ` +
    `claude -p "${DEFAULT_PROMPT}" --allowedTools ${ALLOWED_TOOLS} > '${path.join(runs, 'task-{taskId}.log')}' 2>&1`;
  validateCommandTemplate(command);
  return command;
}

export async function enroll(o: EnrollOptions): Promise<EnrollResult> {
  const home = o.home ?? os.homedir();
  const token = validateToken(o.token);
  const explicit = o.profile !== undefined ? normalizeProfile(o.profile) : activeProfile();
  const existing = explicit ? new ConfigService({ profile: explicit, homeDir: home }) : undefined;
  const apiUrl = validateApiUrl(o.apiUrl ?? existing?.get('apiUrl') ?? currentFlavor.apiUrl);
  const existingAgent = existing?.get('agent') ?? {};
  const hostId = existingAgent.hostId ? normalizeHostId(existingAgent.hostId, 'agent.hostId') : machineHostId(home);
  const agentKind = o.agentKind ? normalizeAgentKind(o.agentKind) : existingAgent.agentKind ?? DEFAULT_AGENT_KIND;

  const r = await redeem(apiUrl, { token, hostId, hostName: os.hostname(), agentKind }, o.http);

  try {
    return save(r, {
      explicit,
      existing,
      home,
      apiUrl,
      hostId,
      agentKind: o.agentKind ? agentKind : undefined,
      forward: o.forward !== false,
      pathEnv: o.pathEnv,
    });
  } catch (e) {
    // the token is spent: say how to get a key again (same host id, within 15 minutes, contract 2.4)
    throw new Error(`兑换成功但写入配置档失败: ${e instanceof Error ? e.message : String(e)}。15 分钟内在本机重跑同一条命令可以重新兑换`);
  }
}

/** The answer's profile name, else `org<orgId>-emp<employeeId>` (design 7.7-6). */
export function profileOf(r: Redeemed): string {
  try {
    if (r.profile) return normalizeProfile(r.profile);
  } catch {
    /* an unusable name from the server must not lose the key: fall back */
  }
  return `org${r.orgId}-emp${r.aiEmployeeId}`;
}

function save(
  r: Redeemed,
  c: {
    explicit?: string;
    existing?: ConfigService;
    home: string;
    apiUrl: string;
    hostId: string;
    agentKind?: string;
    forward: boolean;
    pathEnv?: string;
  }
): EnrollResult {
  const { home, apiUrl, hostId, agentKind } = c;
  const profile = c.explicit ?? profileOf(r);
  const target = c.existing ?? new ConfigService({ profile, homeDir: home });
  const dir = profileDir(profile, home);
  const agent: Record<string, any> = { ...(target.get('agent') ?? {}), hostId, ...(agentKind ? { agentKind } : {}) };
  const kind: string = agent.agentKind ?? DEFAULT_AGENT_KIND;
  // operators enroll + listen until setup / the image exist (B3 / B6): give a Claude Code profile a working forward
  const hadForward = !!(agent.forward?.url || agent.forward?.command);
  let forwardDefaulted = false;
  let forwardSkipped: string | undefined;
  if (!hadForward && c.forward) {
    if (kind !== DEFAULT_AGENT_KIND) {
      forwardSkipped = `agentKind 为 ${kind}，只有 ${DEFAULT_AGENT_KIND} 会自动配置转发命令`;
    } else {
      try {
        agent.forward = { ...(agent.forward ?? {}), command: defaultForwardCommand(dir) };
        forwardDefaulted = true;
      } catch (e) {
        forwardSkipped = e instanceof Error ? e.message : String(e);
      }
    }
  }
  target.update({
    apiUrl,
    apiKey: r.key,
    orgId: r.orgId,
    agent,
    enrollment: {
      orgName: r.orgName,
      aiEmployeeId: r.aiEmployeeId,
      aiEmployeeName: r.aiEmployeeName,
      hostId,
      hostName: os.hostname(),
      enrolledAt: new Date().toISOString(),
    },
  });
  // ConfigService.saveConfig only warns on a failed write: read it back so a lost key is never reported as success
  if (new ConfigService({ profile, homeDir: home }).get('apiKey') !== r.key) throw new Error(`${target.directory()}/config.json 未写入`);
  const { values, skipped } = modelKeyEnv(r.modelKeys);
  if (Object.keys(values).length) writeEnvFile(dir, values);
  const forward = agent.forward ?? {};
  return {
    profile,
    profileDir: dir,
    apiUrl,
    hostId,
    orgId: r.orgId,
    orgName: r.orgName,
    aiEmployeeId: r.aiEmployeeId,
    aiEmployeeName: r.aiEmployeeName,
    modelKeyEnvs: Object.keys(values),
    skippedModelKeys: skipped,
    forwardConfigured: !!(forward.url || forward.command),
    forwardDefaulted,
    forwardSkipped,
    agentKind: kind,
    claudeMissing: forwardDefaulted && !onPath('claude', c.pathEnv),
  };
}

export function describeEnroll(r: EnrollResult): string {
  const lines = [
    `✓ 已接入：${r.aiEmployeeName || `AI 员工 #${r.aiEmployeeId}`}（组织 ${r.orgName || `#${r.orgId}`}）`,
    `  配置档: ${r.profile}（${r.profileDir}）`,
    `  API: ${r.apiUrl}  hostId: ${r.hostId}`,
    `  Key: 已写入配置档（不显示）`,
  ];
  if (r.modelKeyEnvs.length) lines.push(`  模型 Key: 已写入 ${path.join(r.profileDir, 'env')}（${r.modelKeyEnvs.join(', ')}，不显示）`);
  if (r.skippedModelKeys.length) lines.push(`  ! 无法识别的模型 Key 已跳过: ${r.skippedModelKeys.join(', ')}`);
  if (r.forwardDefaulted) {
    lines.push(`  已配置默认的 Claude Code 转发命令（可用 good7ob --profile ${r.profile} config set agent.forward.command 修改）`);
    if (r.claudeMissing) lines.push(`  ! ${CLAUDE_MISSING}`);
  } else if (!r.forwardConfigured) {
    // --no-forward, a non-Claude agent kind or an unusable path: say why and how
    lines.push(`  ! 未配置转发命令${r.forwardSkipped ? `（${r.forwardSkipped}）` : ''}，listen 前先运行: good7ob --profile ${r.profile} config set agent.forward.command '<命令模板>'`);
  }
  lines.push(`下一步: good7ob --profile ${r.profile} agent listen`);
  return lines.join('\n');
}
