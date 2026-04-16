"use strict";
/**
 * API Client Service
 * Handles HTTP communication with the good7ob backend API
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiClient = void 0;
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class ApiClient {
    constructor() {
        // Get API endpoint and key from environment or config file
        this.baseURL = process.env.GOOD7OB_API_URL || this.loadConfigValue('apiUrl') || 'https://api.good7ob.net';
        this.apiKey = process.env.GOOD7OB_API_KEY || this.loadConfigValue('apiKey') || '';
        this.instance = axios_1.default.create({
            baseURL: this.baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'good7ob-cli/0.1.0',
            },
        });
        // Add request interceptor for authentication
        this.instance.interceptors.request.use((config) => {
            if (this.apiKey && config.headers) {
                config.headers['Authorization'] = `Bearer ${this.apiKey}`;
            }
            return config;
        });
        // Add response interceptor for error handling
        this.instance.interceptors.response.use((response) => response, (error) => {
            if (error.response?.status === 401) {
                console.error('Authentication failed. Please check your API key.');
            }
            else if (error.response?.status === 403) {
                console.error('Permission denied.');
            }
            else if (error.response?.status === 404) {
                console.error('Resource not found.');
            }
            else if (error.message === 'Network Error') {
                console.error(`Cannot connect to API server at ${this.baseURL}`);
            }
            return Promise.reject(error);
        });
    }
    /**
     * Make GET request
     */
    async get(url, params) {
        try {
            const response = await this.instance.get(url, { params });
            return response.data.data;
        }
        catch (error) {
            throw this.handleError(error);
        }
    }
    /**
     * Make POST request
     */
    async post(url, data) {
        try {
            const response = await this.instance.post(url, data);
            return response.data.data;
        }
        catch (error) {
            throw this.handleError(error);
        }
    }
    /**
     * Make PUT request
     */
    async put(url, data) {
        try {
            const response = await this.instance.put(url, data);
            return response.data.data;
        }
        catch (error) {
            throw this.handleError(error);
        }
    }
    /**
     * Make PATCH request
     */
    async patch(url, data) {
        try {
            const response = await this.instance.patch(url, data);
            return response.data.data;
        }
        catch (error) {
            throw this.handleError(error);
        }
    }
    /**
     * Make DELETE request
     */
    async delete(url, data) {
        try {
            const response = await this.instance.delete(url, data ? { data } : undefined);
            return response.data.data;
        }
        catch (error) {
            throw this.handleError(error);
        }
    }
    /**
     * Upload file
     */
    async uploadFile(url, filePath, fieldName = 'file', additionalFields) {
        try {
            const fileContent = fs.readFileSync(filePath);
            const fileName = path.basename(filePath);
            // For Node.js, use form-data library approach
            const FormDataLibrary = require('form-data');
            const formData = new FormDataLibrary();
            formData.append(fieldName, fileContent, fileName);
            // Add additional fields if provided
            if (additionalFields) {
                Object.entries(additionalFields).forEach(([key, value]) => {
                    formData.append(key, value);
                });
            }
            const response = await this.instance.post(url, formData, {
                headers: formData.getHeaders(),
            });
            return response.data.data;
        }
        catch (error) {
            throw this.handleError(error);
        }
    }
    /**
     * Set API Key
     */
    setApiKey(apiKey) {
        this.apiKey = apiKey;
    }
    /**
     * Set Base URL
     */
    setBaseURL(baseURL) {
        this.baseURL = baseURL;
        this.instance.defaults.baseURL = baseURL;
    }
    /**
     * Load config value from ~/.good7ob/config.json
     */
    loadConfigValue(key) {
        try {
            const configPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.good7ob', 'config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                return config[key] || null;
            }
        }
        catch (error) {
            // Silently ignore config read errors
        }
        return null;
    }
    /**
     * Handle API errors
     */
    handleError(error) {
        if (error.response?.data?.message) {
            return new Error(error.response.data.message);
        }
        if (error.message) {
            return new Error(error.message);
        }
        return new Error('An unknown error occurred');
    }
}
exports.ApiClient = ApiClient;
exports.default = new ApiClient();
//# sourceMappingURL=ApiClient.js.map