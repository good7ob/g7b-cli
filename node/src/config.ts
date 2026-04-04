import * as fs from 'fs';
import * as path from 'path';
import { Config } from './types';

const CONFIG_DIR = path.join(process.env.HOME || '/root', '.good7ob');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_ENDPOINT = 'http://localhost:9080';

export class ConfigManager {
  private config: Config;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): Config {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(data);
      }
    } catch (err) {
      // Ignore load errors
    }
    return {};
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  public saveConfig(): void {
    this.ensureConfigDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  public set(key: string, value: string): void {
    this.config[key as keyof Config] = value;
    this.saveConfig();
  }

  public get(key: string): string | undefined {
    return this.config[key as keyof Config];
  }

  public getApiKey(): string {
    // Support both 'apiKey' and 'api-key' for backward compatibility
    const apiKey = this.get('apiKey') || this.get('api-key');
    if (!apiKey) {
      throw new Error(
        'API Key not configured. Run: good7ob config set api-key <your-api-key>'
      );
    }
    return apiKey;
  }

  public getEndpoint(): string {
    return this.get('endpoint') || DEFAULT_ENDPOINT;
  }

  public show(): void {
    console.log(JSON.stringify(this.config, null, 2));
  }
}
