/**
 * Configuration Service
 * Manages CLI configuration and credentials.
 *
 * The API address is not configurable: it is the install's flavor (see flavor.ts) — production for a release,
 * the address in dev-env.json for a dev clone.
 */

import * as fs from 'fs';
import * as path from 'path';
import { currentFlavor, dataDir, Flavor, PROD } from './flavor';

export { PROD_API_URL } from './flavor';

interface Config {
  apiUrl: string;
  apiKey: string;
  userId?: number;
  orgId?: number;
  /** project remembered by `good7ob pm project use` */
  projectId?: number;
  theme?: string;
  /** `good7ob agent` settings, see commands/agent/config.ts */
  agent?: Record<string, any>;
}

export interface ConfigOptions {
  homeDir?: string;
  flavor?: Flavor;
}

export class ConfigService {
  private configDir: string;
  private configFile: string;
  private config: Config;
  private readonly flavor: Flavor;
  /** One-line stderr hints for this run (dev banner, ignored legacy apiUrl); the caller decides to print them. */
  readonly notices: readonly string[];

  constructor(opts: ConfigOptions = {}) {
    this.flavor = opts.flavor ?? currentFlavor;
    this.configDir = dataDir(this.flavor, opts.homeDir);
    this.configFile = path.join(this.configDir, 'config.json');
    this.config = this.loadConfig();
    this.notices = this.buildNotices();
  }

  private buildNotices(): string[] {
    const notices: string[] = [];
    if (this.flavor.name !== PROD) {
      notices.push(`[good7ob] 使用 ${this.flavor.name} 环境：${this.flavor.apiUrl}`);
    }
    const stored = (this.config.apiUrl || '').replace(/\/+$/, '');
    if (stored && stored !== this.flavor.apiUrl) {
      notices.push(`[good7ob] 配置文件里的 apiUrl（${stored}）已忽略：本安装固定访问 ${this.flavor.apiUrl}。`);
    }
    return notices;
  }

  /** The environment this install talks to: 'prod' or the dev-env.json name. */
  activeEnvironment(): string {
    return this.flavor.name;
  }

  /**
   * Load configuration from file
   */
  private loadConfig(): Config {
    const defaultConfig: Config = {
      apiUrl: this.flavor.apiUrl,
      apiKey: '',
    };

    try {
      if (!fs.existsSync(this.configDir)) {
        // fix: #109 https://github.com/good7ob/g7b-cli/issues/109
        fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
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
      // fix: #109 https://github.com/good7ob/g7b-cli/issues/109
      // the file holds the API key and the webhook secret: owner-only, also for a directory / file made by an older version
      fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), { encoding: 'utf-8', mode: 0o600 });
      fs.chmodSync(this.configDir, 0o700);
      fs.chmodSync(this.configFile, 0o600);
    } catch (error) {
      console.error('Failed to save configuration:', error);
    }
  }

  /**
   * Get configuration value
   */
  get(key: keyof Config): any {
    return key === 'apiUrl' ? this.flavor.apiUrl : this.config[key];
  }

  /**
   * Set configuration value
   */
  set(key: keyof Config, value: any): void {
    if (key === 'apiUrl') {
      if (value !== this.flavor.apiUrl) {
        throw new Error(`本安装的 API 地址固定为 ${this.flavor.apiUrl}，不能修改`);
      }
      return;
    }
    this.config = { ...this.config, [key]: value };
    this.saveConfig();
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return !!this.config.apiKey && !!this.flavor.apiUrl;
  }

  /**
   * Get all configuration
   */
  getAll(): Config {
    return { ...this.config, apiUrl: this.flavor.apiUrl };
  }

  /**
   * Reset configuration to defaults
   */
  reset(): void {
    this.config = {
      apiUrl: this.flavor.apiUrl,
      apiKey: '',
    };
    this.saveConfig();
  }

  /**
   * Remove credentials
   */
  clearCredentials(): void {
    this.set('apiKey', '');
  }
}

/** Constructing may print hints; do it once per process, for the shared instance only. */
function createDefault(): ConfigService {
  const service = new ConfigService();
  service.notices.forEach((line) => console.error(line));
  return service;
}

export default createDefault();
