/**
 * API Client Service
 * Handles HTTP communication with the good7ob backend API
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface ApiResponse<T> {
  code: number;
  message: string;
  data?: T;
  meta?: {
    total: number;
    page: number;
    limit: number;
  };
}

export class ApiClient {
  private instance: AxiosInstance;
  private baseURL: string;
  private apiKey: string;

  constructor() {
    // Get API endpoint and key from environment or config file
    this.baseURL = process.env.GOOD7OB_API_URL || this.loadConfigValue('apiUrl') || 'https://api.good7ob.net';
    this.apiKey = process.env.GOOD7OB_API_KEY || this.loadConfigValue('apiKey') || '';

    this.instance = axios.create({
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
    this.instance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          console.error('Authentication failed. Please check your API key.');
        } else if (error.response?.status === 403) {
          console.error('Permission denied.');
        } else if (error.response?.status === 404) {
          console.error('Resource not found.');
        } else if (error.message === 'Network Error') {
          console.error(`Cannot connect to API server at ${this.baseURL}`);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Make GET request
   */
  async get<T = any>(url: string, params?: Record<string, any>): Promise<any> {
    try {
      const response = await this.instance.get<ApiResponse<T>>(url, { params });
      return response.data.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Make POST request
   */
  async post<T = any>(url: string, data?: any): Promise<any> {
    try {
      const response = await this.instance.post<ApiResponse<T>>(url, data);
      return response.data.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Make PUT request
   */
  async put<T = any>(url: string, data?: any): Promise<any> {
    try {
      const response = await this.instance.put<ApiResponse<T>>(url, data);
      return response.data.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Make PATCH request
   */
  async patch<T = any>(url: string, data?: any): Promise<any> {
    try {
      const response = await this.instance.patch<ApiResponse<T>>(url, data);
      return response.data.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Make DELETE request
   */
  async delete<T = any>(url: string, data?: any): Promise<any> {
    try {
      const response = await this.instance.delete<ApiResponse<T>>(url, data ? { data } : undefined);
      return response.data.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Upload file
   */
  async uploadFile<T>(url: string, filePath: string, fieldName: string = 'file', additionalFields?: Record<string, string>): Promise<T> {
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

      const response = await this.instance.post<ApiResponse<T>>(url, formData, {
        headers: formData.getHeaders(),
      });

      return response.data.data as T;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Set API Key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Set Base URL
   */
  setBaseURL(baseURL: string): void {
    this.baseURL = baseURL;
    this.instance.defaults.baseURL = baseURL;
  }

  /**
   * Load config value from ~/.good7ob/config.json
   */
  private loadConfigValue(key: string): string | null {
    try {
      const configPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.good7ob', 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return config[key] || null;
      }
    } catch (error) {
      // Silently ignore config read errors
    }
    return null;
  }

  /**
   * Handle API errors
   */
  private handleError(error: any): Error {
    if (error.response?.data?.message) {
      return new Error(error.response.data.message);
    }
    if (error.message) {
      return new Error(error.message);
    }
    return new Error('An unknown error occurred');
  }
}

export default new ApiClient();
