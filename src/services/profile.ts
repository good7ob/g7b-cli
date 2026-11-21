/**
 * Configuration profiles (`--profile <name>` / env GOOD7OB_PROFILE, g7b #3632).
 *
 * A profile is a separate identity on one machine: its own config (API address + key), work slot, heartbeat
 * entries, runner.log, runs/ and cache, all under `~/.good7ob-profiles/<name>/`. Without a profile nothing
 * changes: the install's own data dir (`~/.good7ob`, or `~/.good7ob-<flavor>` for a dev clone).
 *
 * The global `--profile` flag is read from argv before any command module loads (the shared ConfigService is
 * built at import time) and turned into GOOD7OB_PROFILE, so child processes — the heartbeat loop, the forward
 * command and every `good7ob` it runs — stay on the same profile.
 */

import * as fs from 'fs';
import * as path from 'path';

export const PROFILE_ENV = 'GOOD7OB_PROFILE';
export const PROFILES_DIR = '.good7ob-profiles';
/** Model keys and other secrets for the agent process, `KEY=value` per line, mode 600. */
export const ENV_FILE = 'env';
export const RUNNER_LOG = 'runner.log';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A profile name is one path segment: letters, digits, `.`, `_`, `-`, starting with a letter or digit, ≤ 64. */
export function normalizeProfile(raw: unknown, label = '--profile'): string {
  const name = String(raw ?? '').trim();
  if (!NAME.test(name)) {
    throw new Error(`${label} 只能用字母、数字、点、下划线和连字符，以字母或数字开头，最长 64 个字符，收到: ${JSON.stringify(raw ?? '')}`);
  }
  return name;
}

/** The active profile from the environment; `undefined` when none (empty counts as none). Throws on a bad name. */
export function activeProfile(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env[PROFILE_ENV];
  if (raw == null || raw.trim() === '') return undefined;
  return normalizeProfile(raw, PROFILE_ENV);
}

export function profileDir(name: string, home: string): string {
  return path.join(home, PROFILES_DIR, normalizeProfile(name));
}

/**
 * The `--profile` value among the root options, i.e. before the first command word (`good7ob --profile x agent
 * listen`). A `--profile` after the command belongs to that command (`agent enroll --profile`) and is left alone.
 */
export function profileFromArgv(argv: string[]): string | undefined {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return undefined;
    if (a === '--profile') return args[i + 1] ?? '';
    if (a.startsWith('--profile=')) return a.slice('--profile='.length);
    if (!a.startsWith('-')) return undefined;
  }
  return undefined;
}

/** `--profile` on the command line wins over an inherited GOOD7OB_PROFILE; the result is written back to `env`. */
export function applyProfileArgv(argv: string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  const flag = profileFromArgv(argv);
  if (flag !== undefined) env[PROFILE_ENV] = normalizeProfile(flag);
  return activeProfile(env);
}

/** `KEY=value` lines; blank lines and `#` comments skipped, surrounding quotes on the value removed. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!ENV_NAME.test(key)) continue;
    let value = t.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** The profile's env file, `{}` when it does not exist. */
export function readEnvFile(dir: string): Record<string, string> {
  const file = path.join(dir, ENV_FILE);
  if (!fs.existsSync(file)) return {};
  return parseEnvFile(fs.readFileSync(file, 'utf-8'));
}

/**
 * Merges `values` into the env file (other entries kept, e.g. a token `setup` stored) and leaves it at mode 600,
 * written to a temp file first so a crash never leaves half a key behind.
 */
export function writeEnvFile(dir: string, values: Record<string, string>): string {
  for (const [k, v] of Object.entries(values)) {
    if (!ENV_NAME.test(k)) throw new Error(`环境变量名不合法: ${k}`);
    if (/[\r\n]/.test(v)) throw new Error(`环境变量 ${k} 的值含换行，拒绝写入`);
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const merged = { ...readEnvFile(dir), ...values };
  const file = path.join(dir, ENV_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  const body = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  fs.writeFileSync(tmp, body ? `${body}\n` : '', { encoding: 'utf-8', mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
  return file;
}
