/**
 * API Client Service
 * Handles HTTP communication with the good7ob backend API
 */
export declare class ApiClient {
    private instance;
    private baseURL;
    private apiKey;
    constructor();
    /**
     * Make GET request
     */
    get<T = any>(url: string, params?: Record<string, any>): Promise<any>;
    /**
     * Make POST request
     */
    post<T = any>(url: string, data?: any): Promise<any>;
    /**
     * Make PUT request
     */
    put<T = any>(url: string, data?: any): Promise<any>;
    /**
     * Make PATCH request
     */
    patch<T = any>(url: string, data?: any): Promise<any>;
    /**
     * Make DELETE request
     */
    delete<T = any>(url: string, data?: any): Promise<any>;
    /**
     * Upload file
     */
    uploadFile<T>(url: string, filePath: string, fieldName?: string, additionalFields?: Record<string, string>): Promise<T>;
    /**
     * Set API Key
     */
    setApiKey(apiKey: string): void;
    /**
     * Set Base URL
     */
    setBaseURL(baseURL: string): void;
    /**
     * Load config value from ~/.good7ob/config.json
     */
    private loadConfigValue;
    /**
     * Handle API errors
     */
    private handleError;
}
declare const _default: ApiClient;
export default _default;
//# sourceMappingURL=ApiClient.d.ts.map