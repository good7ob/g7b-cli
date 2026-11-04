/**
 * Configuration Service
 * Manages CLI configuration and credentials.
 *
 * Environments: a release build always talks to PROD_API_URL. A non-prod environment (dev / test / local ...) has to be
 * defined in the config file under `environments.<name>` and switched on per process with GOOD7OB_ENV=<name>, so one
 * machine can use two environments at once and nothing is left switched on by accident.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** The only address a release build uses unless GOOD7OB_ENV names a defined environment. */
export const PROD_API_URL = 'https://api.good7ob.com';
const PROD = 'prod';
const ENV_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/** Everything that differs between environments: a key, an org or a project of one is meaningless in another. */
export interface EnvProfile {
  apiUrl?: string;
  apiKey?: string;
  userId?: number;
  orgId?: number;
  projectId?: number;
}
export type EnvField = keyof EnvProfile;
export const ENV_FIELDS: readonly EnvField[] = ['apiUrl', 'apiKey', 'userId', 'orgId', 'projectId'];
const SCOPED = new Set<string>(ENV_FIELDS);

interface Config extends EnvProfile {
  apiUrl: string;
  apiKey: string;
  theme?: string;
  /** `good7ob agent` settings, see commands/agent/config.ts */
  agent?: Record<string, any>;
  /** Non-prod environments, switched on with GOOD7OB_ENV=<name>. */
  environments?: Record<string, EnvProfile>;
}

export interface ConfigOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export class ConfigService {
  private configDir: string;
  private configFile: string;
  private config: Config;
  /** The active non-prod environment, undefined for prod. */
  private readonly profile: string | undefined;
  /** One-line stderr hints for this run (non-prod banner, ignored legacy apiUrl); the caller decides to print them. */
  readonly notices: readonly string[];

  constructor(opts: ConfigOptions = {}) {
    this.configDir = path.join(opts.homeDir ?? os.homedir(), '.good7ob');
    this.configFile = path.join(this.configDir, 'config.json');
    this.config = this.loadConfig();

    const name = (opts.env ?? process.env).GOOD7OB_ENV?.trim();
    this.profile = !name || name === PROD ? undefined : name;
    if (this.profile && !this.config.environments?.[this.profile]?.apiUrl) {
      throw new Error(
        `GOOD7OB_ENV=${this.profile}，但配置文件里没有这个环境。先定义：` +
          `good7ob config set environments.${this.profile}.apiUrl <地址>`
      );
    }
    this.notices = this.buildNotices();
  }

  private buildNotices(): string[] {
    if (this.profile) {
      return [`[good7ob] 使用 ${this.profile} 环境：${this.get('apiUrl')}`];
    }
    const legacy = (this.config.apiUrl || '').replace(/\/+$/, '');
    return legacy && legacy !== PROD_API_URL
      ? [
          `[good7ob] 配置文件里的 apiUrl（${legacy}）已忽略：发布版固定访问生产 ${PROD_API_URL}。` +
            '访问非生产环境请先 config set environments.<名>.apiUrl 定义，再用 GOOD7OB_ENV=<名> 启用。',
        ]
      : [];
  }

  /** The environment this process talks to: 'prod' or the GOOD7OB_ENV name. */
  activeEnvironment(): string {
    return this.profile ?? PROD;
  }

  /**
   * Load configuration from file
   */
  private loadConfig(): Config {
    const defaultConfig: Config = {
      apiUrl: PROD_API_URL,
      apiKey: '',
    };

    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }

      if (fs.existsSync(this.configFile)) {
        const fileContent = fs.readFileSync(this.configFile, 'utf-8');
        return { ...defaultConfig, ...JSON.parse(fileContent) };
      }
    } catch (error) {
      console.warn('Failed to load config, using defaults');
    }

    return defaultConfig;
  }

  /**
   * Save configuration to file
   */
  saveConfig(): void {
    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save configuration:', error);
    }
  }

  /**
   * Get configuration value. url / key / user / org / project are the active environment's own.
   */
  get(key: keyof Config): any {
    if (!this.profile) {
      return key === 'apiUrl' ? PROD_API_URL : this.config[key];
    }
    return SCOPED.has(key) ? this.config.environments?.[this.profile]?.[key as EnvField] : this.config[key];
  }

  /**
   * Set configuration value. In a non-prod environment the scoped keys land in that environment's section.
   */
  set(key: keyof Config, value: any): void {
    if (!this.profile && key === 'apiUrl') {
      if (value !== PROD_API_URL) {
        throw new Error(`生产地址固定为 ${PROD_API_URL}；非生产环境请用 config set environments.<名>.apiUrl`);
      }
      return;
    }
    if (this.profile && SCOPED.has(key)) {
      this.writeEnvField(this.profile, key as EnvField, value);
      return;
    }
    this.config = { ...this.config, [key]: value };
    this.saveConfig();
  }

  /** Read one field of a named environment (as `config get environments.<name>.<field>`). */
  getEnvField(name: string, field: EnvField): any {
    return this.config.environments?.[name]?.[field];
  }

  /** Define or change a field of a named non-prod environment. */
  setEnvField(name: string, field: EnvField, value: string | number): void {
    if (name === PROD) {
      throw new Error('prod 是固定的生产环境，不能在配置文件里定义');
    }
    if (!ENV_NAME.test(name)) {
      throw new Error(`环境名只能用小写字母、数字和连字符，且以字母开头：${name}`);
    }
    this.writeEnvField(name, field, value);
  }

  private writeEnvField(name: string, field: EnvField, value: unknown): void {
    const environments = this.config.environments ?? {};
    this.config = {
      ...this.config,
      environments: { ...environments, [name]: { ...environments[name], [field]: value } },
    };
    this.saveConfig();
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return !!this.get('apiKey') && !!this.get('apiUrl');
  }

  /**
   * Get all configuration, with the active environment's values in place of the scoped ones.
   */
  getAll(): Config {
    const scoped = Object.fromEntries(ENV_FIELDS.map((f) => [f, this.get(f)]));
    return { ...this.config, ...scoped };
  }

  /** The defined non-prod environments. */
  listEnvironments(): Record<string, EnvProfile> {
    return { ...(this.config.environments ?? {}) };
  }

  /**
   * Reset configuration to defaults
   */
  reset(): void {
    this.config = {
      apiUrl: PROD_API_URL,
      apiKey: '',
    };
    this.saveConfig();
  }

  /**
   * Remove credentials of the active environment
   */
  clearCredentials(): void {
    this.set('apiKey', '');
  }
}

/** Fails the run with a readable message instead of a stack trace when GOOD7OB_ENV names an undefined environment. */
function createDefault(): ConfigService {
  try {
    const service = new ConfigService();
    service.notices.forEach((line) => console.error(line));
    return service;
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export default createDefault();
