import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { ConfigManager } from './config';

export class ApiClient {
  private client: AxiosInstance;
  private config: ConfigManager;

  constructor() {
    this.config = new ConfigManager();
    const endpoint = this.config.getEndpoint();
    const apiKey = this.config.getApiKey();

    this.client = axios.create({
      baseURL: endpoint,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          const { status, data } = error.response;
          const message = data?.msg || data?.message || error.message;
          throw new Error(`API Error [${status}]: ${message}`);
        } else if (error.code === 'ECONNREFUSED') {
          throw new Error(
            `Cannot connect to backend at ${endpoint}. Make sure the server is running.`
          );
        } else if (error.message) {
          throw new Error(`Network Error: ${error.message}`);
        }
        throw new Error('Unknown error occurred');
      }
    );
  }

  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<any>(url, config);
    return response.data?.data || response.data;
  }

  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.client.post<any>(url, data, config);
    return response.data?.data || response.data;
  }

  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.client.put<any>(url, data, config);
    return response.data?.data || response.data;
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<any>(url, config);
    return response.data?.data || response.data;
  }
}
