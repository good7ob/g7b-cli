import { ApiDate } from '../../utils/cliHelpers';
/** Renderers for `workspace daily-report` and `workspace next-actions` (api-0089 §8, §9). */
export interface DailyReport {
    date?: string | null;
    source?: string | null;
    generatedAt?: ApiDate;
    content?: string | null;
    /** Structured sections; shown only with --json. */
    sections?: {
        degraded?: string[] | null;
    } & Record<string, unknown> | null;
    aiWarning?: string | null;
}
export interface NextAction {
    kind?: string | null;
    itemId?: number | null;
    taskId?: number | null;
    sourceType?: string | null;
    sourceId?: number | null;
    actionType?: string | null;
    title?: string | null;
    priority?: string | null;
    dueAt?: ApiDate;
    productId?: number | null;
    orgId?: number | null;
    score?: number | null;
    reasons?: string[] | null;
    factors?: {
        code?: string;
        points?: number;
    }[] | null;
}
export interface NextActions {
    total?: number | null;
    items?: NextAction[] | null;
}
/** `generated`: shown right after `daily-report generate`, so the header says it was (re)generated. */
export declare function renderDailyReport(r: DailyReport, generated?: boolean): string;
export declare function renderNextActions(n: NextActions): string;
//# sourceMappingURL=renderDaily.d.ts.map