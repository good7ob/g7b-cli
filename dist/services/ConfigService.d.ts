/**
 * Configuration Service
 * Manages CLI configuration and credentials
 */
interface Config {
    apiUrl: string;
    apiKey: string;
    userId?: number;
    theme?: string;
}
export declare class ConfigService {
    private configDir;
    private configFile;
    private config;
    constructor();
    /**
     * Load configuration from file
     */
    private loadConfig;
    /**
     * Save configuration to file
     */
    saveConfig(): void;
    /**
     * Get configuration value
     */
    get(key: keyof Config): any;
    /**
     * Set configuration value
     */
    set(key: keyof Config, value: any): void;
    /**
     * Check if API key is configured
     */
    isConfigured(): boolean;
    /**
     * Get all configuration
     */
    getAll(): Config;
    /**
     * Reset configuration to defaults
     */
    reset(): void;
    /**
     * Remove credentials
     */
    clearCredentials(): void;
}
declare const _default: ConfigService;
export default _default;
//# sourceMappingURL=ConfigService.d.ts.map