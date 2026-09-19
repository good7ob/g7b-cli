import { ApiDate } from '../../utils/cliHelpers';
export interface QueueItem {
    id?: number | null;
    status?: string | null;
    sourceType?: string | null;
    sourceId?: number | null;
    title?: string | null;
    actionType?: string | null;
    priority?: string | null;
    description?: string | null;
    dueAt?: ApiDate;
    snoozedUntil?: ApiDate;
    projectId?: number | null;
    projectName?: string | null;
    productId?: number | null;
    orgId?: number | null;
    createdAt?: ApiDate;
}
export interface MyQueue {
    total?: number | null;
    counts?: Record<string, number | null> | null;
    items?: QueueItem[] | null;
}
export interface QueueCounts {
    total?: number | null;
    counts?: Record<string, number | null> | null;
    snoozed?: number | null;
    dismissed?: number | null;
    done?: number | null;
}
export interface QueueActionResult {
    item?: QueueItem | null;
    action?: string | null;
    outcome?: string | null;
}
export declare const ACTION_LABELS: Record<string, string>;
/** `计划审批 3  完成审批 0 …` — every action type, a count the backend did not send is —, never 0. */
export declare function renderCountsSummary(counts: Record<string, number | null> | null | undefined): string;
export declare function renderQueue(queue: MyQueue, status?: string): string;
/** `workspace queue counts`: active total + per action type, then the parked buckets. */
export declare function renderQueueCounts(c: QueueCounts): string;
declare const TRANSITION_LABELS: {
    readonly dismiss: "已忽略";
    readonly snooze: "已稍后处理";
    readonly done: "已标记处理";
    readonly reopen: "已重新打开";
};
export type Transition = keyof typeof TRANSITION_LABELS;
export declare function renderTransition(kind: Transition, id: number, item?: QueueItem | null): string;
export declare function renderDecision(id: number, result?: QueueActionResult | null): string;
export {};
//# sourceMappingURL=render.d.ts.map