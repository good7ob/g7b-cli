/**
 * Configuration Service
 * Manages CLI configuration and credentials
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface Config {
  apiUrl: string;
  apiKey: string;
  userId?: number;
  theme?: string;
}

export class ConfigService {
  private configDir: string;
  private configFile: string;
  private config: Config;

  constructor() {
    const homeDir = os.homedir();
    this.configDir = path.join(homeDir, '.good7ob');
    this.configFile = path.join(this.configDir, 'config.json');
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from file
   */
  private loadConfig(): Config {
    const defaultConfig: Config = {
      apiUrl: 'https://api.good7ob.net',
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
   * Get configuration value
   */
  get(key: keyof Config): any {
    return this.config[key];
  }

  /**
   * Set configuration value
   */
  set(key: keyof Config, value: any): void {
    (this.config as any)[key] = value;
    this.saveConfig();
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return !!this.config.apiKey && !!this.config.apiUrl;
  }

  /**
   * Get all configuration
   */
  getAll(): Config {
    return { ...this.config };
  }

  /**
   * Reset configuration to defaults
   */
  reset(): void {
    this.config = {
      apiUrl: 'https://api.good7ob.net',
      apiKey: '',
    };
    this.saveConfig();
  }

  /**
   * Remove credentials
   */
  clearCredentials(): void {
    this.config.apiKey = '';
    this.saveConfig();
  }
}

export default new ConfigService();
