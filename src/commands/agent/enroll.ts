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
  home?: string;
  http?: RedeemHttp;
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
    return save(r, { explicit, existing, home, apiUrl, hostId, agentKind: o.agentKind ? agentKind : undefined });
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
  c: { explicit?: string; existing?: ConfigService; home: string; apiUrl: string; hostId: string; agentKind?: string }
): EnrollResult {
  const { home, apiUrl, hostId, agentKind } = c;
  const profile = c.explicit ?? profileOf(r);
  const target = c.existing ?? new ConfigService({ profile, homeDir: home });
  const agent = { ...(target.get('agent') ?? {}), hostId, ...(agentKind ? { agentKind } : {}) };
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
  const dir = profileDir(profile, home);
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
  if (!r.forwardConfigured) {
    lines.push(`  ! 还没有配置转交方式，先运行: good7ob --profile ${r.profile} config set agent.forward.command '<命令模板>'`);
  }
  lines.push(`下一步: good7ob --profile ${r.profile} agent listen`);
  return lines.join('\n');
}
