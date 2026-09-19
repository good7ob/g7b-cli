import { ApiDate } from '../../utils/cliHelpers';
/** Renderers for `workspace ai-team` / `ai-team log` and the overview's AI team block (api-0089 §7). */
export interface TaskRef {
    id?: number | null;
    name?: string | null;
    status?: string | null;
    blockedReason?: string | null;
}
/** Lifetime numbers. `cost` is always null on the backend (no token price source) — it is not shown. */
export interface AiStats {
    tasksCompleted?: number | null;
    successRate?: number | null;
    workingHours?: number | null;
    tokens?: number | null;
    cost?: number | null;
    score?: number | null;
    reworkRejected?: number | null;
    blockedEvents?: number | null;
}
export interface AiEmployee {
    id?: number | null;
    orgId?: number | null;
    orgName?: string | null;
    name?: string | null;
    agentKind?: string | null;
    state?: string | null;
    stateReason?: string | null;
    currentTasks?: TaskRef[] | null;
    /** Absent in the overview's `top` list. */
    queueLength?: number | null;
    stats?: AiStats | null;
}
export type AiTeamCounts = Record<string, number | null>;
export interface AiTeam {
    total?: number | null;
    counts?: AiTeamCounts | null;
    employees?: AiEmployee[] | null;
}
export interface AiTeamSummary {
    total?: number | null;
    working?: number | null;
    waiting?: number | null;
    error?: number | null;
    idle?: number | null;
    top?: AiEmployee[] | null;
}
export interface WorkLogEntry {
    time?: ApiDate;
    type?: string | null;
    taskId?: number | null;
    title?: string | null;
    detail?: string | null;
}
export interface WorkLog {
    employeeId?: number | null;
    from?: ApiDate;
    to?: ApiDate;
    pageNum?: number | null;
    pageSize?: number | null;
    total?: number | null;
    items?: WorkLogEntry[] | null;
}
export declare function countsLine(c: AiTeamCounts | AiTeamSummary | null | undefined): string;
export declare function renderAiTeam(team: AiTeam, status?: string): string;
export declare function renderWorkLog(log: WorkLog): string;
/** The overview block: counters + the AI employees needing attention first (`top`). */
export declare function renderAiTeamSummary(s: AiTeamSummary): string;
//# sourceMappingURL=renderAiTeam.d.ts.map