import { ApiDate } from '../../utils/cliHelpers';
export interface QueueItem {
    sourceType?: string | null;
    sourceId?: number | null;
    title?: string | null;
    actionType?: string | null;
    priority?: string | null;
    projectId?: number | null;
    projectName?: string | null;
    createdAt?: ApiDate;
}
export interface MyQueue {
    total?: number | null;
    counts?: Record<string, number | null> | null;
    items?: QueueItem[] | null;
}
export declare const ACTION_LABELS: Record<string, string>;
export declare function renderQueue(queue: MyQueue): string;
//# sourceMappingURL=render.d.ts.map