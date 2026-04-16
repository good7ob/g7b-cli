"use strict";
/**
 * Configuration Service
 * Manages CLI configuration and credentials
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
class ConfigService {
    constructor() {
        const homeDir = os.homedir();
        this.configDir = path.join(homeDir, '.good7ob');
        this.configFile = path.join(this.configDir, 'config.json');
        this.config = this.loadConfig();
    }
    /**
     * Load configuration from file
     */
    loadConfig() {
        const defaultConfig = {
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
        }
        catch (error) {
            console.warn('Failed to load config, using defaults');
        }
        return defaultConfig;
    }
    /**
     * Save configuration to file
     */
    saveConfig() {
        try {
            if (!fs.existsSync(this.configDir)) {
                fs.mkdirSync(this.configDir, { recursive: true });
            }
            fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2), 'utf-8');
        }
        catch (error) {
            console.error('Failed to save configuration:', error);
        }
    }
    /**
     * Get configuration value
     */
    get(key) {
        return this.config[key];
    }
    /**
     * Set configuration value
     */
    set(key, value) {
        this.config[key] = value;
        this.saveConfig();
    }
    /**
     * Check if API key is configured
     */
    isConfigured() {
        return !!this.config.apiKey && !!this.config.apiUrl;
    }
    /**
     * Get all configuration
     */
    getAll() {
        return { ...this.config };
    }
    /**
     * Reset configuration to defaults
     */
    reset() {
        this.config = {
            apiUrl: 'https://api.good7ob.net',
            apiKey: '',
        };
        this.saveConfig();
    }
    /**
     * Remove credentials
     */
    clearCredentials() {
        this.config.apiKey = '';
        this.saveConfig();
    }
}
exports.ConfigService = ConfigService;
exports.default = new ConfigService();
//# sourceMappingURL=ConfigService.js.map