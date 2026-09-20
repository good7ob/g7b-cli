/** Renderers for `pm health diagnosis` and `pm health explain` (api-0090 §12). */
export interface Finding {
    severity?: string | null;
    code?: string | null;
    message?: string | null;
    data?: Record<string, unknown> | null;
}
export interface ModuleFact {
    projectId?: number | null;
    moduleName?: string | null;
    delayDays?: number | null;
    weightSharePct?: number | null;
    contributionDays?: number | null;
    sharePct?: number | null;
    blockedTasks?: number | null;
}
export interface DiagnosisFacts {
    scope?: {
        scope?: number | null;
        completed?: number | null;
        remaining?: number | null;
        weightedProgress?: number | null;
    } | null;
    schedule?: {
        plannedEndDate?: string | null;
        timeProgressPct?: number | null;
    } | null;
    weightedDelayDays?: number | null;
    modules?: ModuleFact[] | null;
    scopeGrowth?: {
        baselineScope?: number | null;
        growthPctOfBaseline?: number | null;
        netDelta?: number | null;
        impactDays?: number | null;
    } | null;
    blocked?: {
        blockedWeight?: number | null;
        blockedRatioPct?: number | null;
    } | null;
    velocity?: {
        recentAvg?: number | null;
        previousAvg?: number | null;
        changePct?: number | null;
        trend?: string | null;
    } | null;
}
export interface Diagnosis {
    productId?: number | null;
    releaseId?: number | null;
    weightBasis?: string | null;
    asOfDate?: string | null;
    overallSeverity?: string | null;
    findings?: Finding[] | null;
    facts?: DiagnosisFacts | null;
}
/** `POST …/explain`: always HTTP 200; when the AI cannot be used `aiAvailable` is false and the findings still come back. */
export interface Explain extends Diagnosis {
    aiAvailable?: boolean | null;
    aiGenerated?: boolean | null;
    source?: string | null;
    cached?: boolean | null;
    explanation?: string | null;
    question?: string | null;
    model?: string | null;
    tokensUsed?: number | null;
    aiWarning?: string | null;
}
export declare function renderFindings(findings: Finding[]): string;
export declare function renderDiagnosis(d: Diagnosis): string;
export declare function renderExplain(e: Explain): string;
//# sourceMappingURL=renderDiagnosis.d.ts.map