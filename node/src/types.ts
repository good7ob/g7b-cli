/**
 * Shared type definitions for good7ob CLI
 */

export interface Project {
  id?: number;
  projectName?: string;
  name?: string;
  description?: string;
  status?: string;
  userId?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Task {
  id?: number;
  title?: string;
  description?: string;
  projectId?: number;
  status?: string;
  assignee?: number;
  priority?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ImportResult {
  successCount: number;
  failureCount: number;
  totalCount: number;
  data: any[];
  failures?: Array<{ error: string; [key: string]: any }>;
}

export interface Config {
  apiKey?: string;
  endpoint?: string;
}
