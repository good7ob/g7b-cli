/**
 * API Client Service
 * Handles HTTP communication with the good7ob backend API
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/** Backend common/util/ApiTimes.HEADER / EPOCH_MS. */
export const TIME_FORMAT_HEADER = 'X-Time-Format';
export const TIME_FORMAT_EPOCH_MS = 'epoch-ms';

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

/** One part of ApiClient.uploadMultipart: a file (`filePath`), a JSON body (`json`) or a plain field (`value`). */
export interface MultipartPart {
  name: string;
  value?: string;
  json?: unknown;
  filePath?: string;
  /** file name sent for a file part (defaults to the basename) */
  fileName?: string;
  contentType?: string;
}

// fix: #564 https://github.com/good7ob/backend/issues/564
// /api/infra/** is isolated per organization: the backend requires X-Org-Id on those calls.
export function withInfraOrg(config: AxiosRequestConfig, orgId: number | undefined): AxiosRequestConfig {
  if (!orgId || !config.url?.startsWith('/api/infra') || config.headers?.['X-Org-Id']) {
    return config;
  }
  return { ...config, headers: { ...config.headers, 'X-Org-Id': String(orgId) } };
}

export class ApiClient {
  private instance: AxiosInstance;
  private baseURL: string;
  private apiKey: string;
  private infraOrgId: number | undefined;

  constructor() {
    // Get API endpoint and key from environment or config file
    this.baseURL = process.env.GOOD7OB_API_URL || this.loadConfigValue('apiUrl') || 'https://api.good7ob.net';
    this.apiKey = process.env.GOOD7OB_API_KEY || this.loadConfigValue('apiKey') || '';

    this.instance = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'good7ob-cli/0.2.0',
        // Date-times come back as epoch ms; rendered as JST by utils/cliHelpers fmtDate/fmtDateTime. --json passes them through.
        [TIME_FORMAT_HEADER]: TIME_FORMAT_EPOCH_MS,
      },
    });

    // Add request interceptor for authentication
    this.instance.interceptors.request.use((config) => {
      if (this.apiKey && config.headers) {
        config.headers['Authorization'] = `Bearer ${this.apiKey}`;
      }
      return withInfraOrg(config, this.infraOrgId);
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

  /** Send a header with every later request of this process (the file commands mark themselves as the CLI). */
  setDefaultHeader(name: string, value: string): void {
    this.instance.defaults.headers.common[name] = value;
  }

  /**
   * Make GET request
   */
  async get<T = any>(url: string, params?: Record<string, any>, config?: AxiosRequestConfig): Promise<any> {
    try {
      const response = await this.instance.get<ApiResponse<T>>(url, { ...config, params });
      return this.unwrap(response.data);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Make POST request
   */
  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<any> {
    try {
      // `config` (e.g. a longer timeout for AI calls) is forwarded only when given
      const response = config
        ? await this.instance.post<ApiResponse<T>>(url, data, config)
        : await this.instance.post<ApiResponse<T>>(url, data);
      return this.unwrap(response.data);
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
      return this.unwrap(response.data);
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
      return this.unwrap(response.data);
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
      return this.unwrap(response.data);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Request an endpoint that returns the bare body (no `{code,data}` envelope), e.g. /forge/kb/*.
   * HTTP errors still surface through handleError via their `message`.
   */
  async requestRaw<T = any>(method: 'get' | 'post', url: string, opts: { params?: Record<string, any>; data?: any; headers?: Record<string, string> } = {}): Promise<T> {
    try {
      const response = method === 'get'
        ? await this.instance.get<T>(url, { params: opts.params, headers: opts.headers })
        : await this.instance.post<T>(url, opts.data, { headers: opts.headers });
      const body: any = response.data;
      // success bodies are bare, but failures come back as an envelope (e.g. code 2000 on 200)
      if (body && typeof body === 'object' && !Array.isArray(body) && body.success === false) {
        const err: any = new Error(body.msg || body.message || '请求失败');
        err.code = body.code;
        err.payload = body;
        throw err;
      }
      return body as T;
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
   * Upload several files under one multipart field (Spring `List<MultipartFile>`).
   * Unlike uploadFile the envelope goes through unwrap, so business errors surface.
   */
  async uploadFiles(url: string, filePaths: string[], fieldName: string, fields?: Record<string, string>, extraFiles?: Record<string, string>): Promise<any> {
    try {
      const FormDataLibrary = require('form-data');
      const formData = new FormDataLibrary();
      Object.entries(fields ?? {}).forEach(([key, value]) => formData.append(key, value));
      filePaths.forEach((p) => formData.append(fieldName, fs.readFileSync(p), path.basename(p)));
      Object.entries(extraFiles ?? {}).forEach(([key, p]) => formData.append(key, fs.readFileSync(p), path.basename(p)));

      const response = await this.instance.post(url, formData, {
        headers: formData.getHeaders(),
        // follow-redirects caps bodies at 10MB by default; a 50-file batch can exceed that
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return this.unwrap(response.data);
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Multipart with mixed parts: plain fields, a JSON part (Spring `@RequestPart` needs its
   * `application/json` type) and files streamed from disk under a chosen file name, so several
   * same-named files (Playwright's `test-failed-1.png` in every result folder) stay apart.
   */
  async uploadMultipart(url: string, parts: MultipartPart[], options: { timeoutMs?: number } = {}): Promise<any> {
    try {
      const FormDataLibrary = require('form-data');
      const formData = new FormDataLibrary();
      for (const p of parts) {
        if (p.filePath) {
          formData.append(p.name, fs.createReadStream(p.filePath), {
            filename: p.fileName ?? path.basename(p.filePath),
            contentType: p.contentType,
            knownLength: fs.statSync(p.filePath).size,
          });
        } else if (p.json !== undefined) {
          formData.append(p.name, JSON.stringify(p.json), { contentType: 'application/json', filename: p.fileName });
        } else if (p.value !== undefined) {
          formData.append(p.name, p.value);
        }
      }
      // every part has a known length, so send Content-Length instead of a chunked body
      const headers: Record<string, string> = { ...formData.getHeaders(), 'Content-Length': String(formData.getLengthSync()) };
      const response = await this.instance.post(url, formData, {
        headers,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
      });
      return this.unwrap(response.data);
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
  /** The org every /api/infra call of this run acts on (set by the `infra` command's preAction). */
  setInfraOrgId(orgId: number): void {
    this.infraOrgId = orgId;
  }

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
  /**
   * Unwrap the response envelope.
   *
   * The backend answers business failures with HTTP 200 and a non-200 `code`
   * in the body, so axios never rejects. Returning `response.data.data` blindly
   * hands the caller `undefined` and loses the server's message entirely — the
   * command then dies on a property access with an error that says nothing
   * about what actually went wrong. Throw here instead, and carry `code` plus
   * the full payload so callers that need it (the active-cap rejection ships
   * the current active list) can still reach it.
   */
  private unwrap<T>(body: ApiResponse<T> | any): any {
    const code = body?.code;
    if (code != null && code !== 200) {
      const err: any = new Error(body?.msg || body?.message || `请求失败 (code=${code})`);
      err.code = code;
      err.payload = body;
      throw err;
    }
    return body?.data;
  }

  private handleError(error: any): Error {
    if (error?.payload) {
      return error;
    }
    const msg = error.response?.data?.msg || error.response?.data?.message;
    if (msg) {
      // Keep the business code / HTTP status so callers can tell e.g. a 409 conflict apart.
      const err: any = new Error(msg);
      err.code = error.response.data.code ?? error.response.status;
      err.status = error.response.status;
      return err;
    }
    if (error.message) {
      const err: any = new Error(error.message);
      if (error.response?.status) err.status = error.response.status;
      return err;
    }
    return new Error('An unknown error occurred');
  }
}

export default new ApiClient();
