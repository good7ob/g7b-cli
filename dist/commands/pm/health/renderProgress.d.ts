import { ApiDate } from '../../../utils/cliHelpers';
export interface ProgressConfig {
    productId?: number | null;
    configured?: boolean | null;
    weightBasis?: string | null;
    statusCompletion?: Record<string, number> | null;
    effectiveStatusCompletion?: Record<string, number> | null;
    defaultStatusCompletion?: Record<string, number> | null;
    updatedBy?: number | null;
    updatedAt?: ApiDate;
}
export interface ScopeChange {
    id: number;
    productId?: number | null;
    releaseId?: number | null;
    changedAt?: ApiDate;
    deltaScope?: number | null;
    scopeAfter?: number | null;
    weightBasis?: string | null;
    kind?: string | null;
    reason?: string | null;
    addedTaskIds?: number[] | null;
    removedTaskIds?: number[] | null;
    createdBy?: number | null;
}
export interface ScopeChangePage {
    records?: ScopeChange[] | null;
    total?: number | null;
    current?: number | null;
    size?: number | null;
    pages?: number | null;
}
export interface BurnupPoint {
    date?: string | null;
    scope?: number | null;
    completed?: number | null;
    remaining?: number | null;
}
export interface Burnup {
    productId?: number | null;
    releaseId?: number | null;
    weightBasis?: string | null;
    from?: string | null;
    to?: string | null;
    baselineScope?: number | null;
    points?: BurnupPoint[] | null;
}
export interface RebuildResult {
    days?: number | null;
    from?: string | null;
    to?: string | null;
    created?: number | null;
    skipped?: number | null;
}
export declare function renderConfig(c: ProgressConfig, saved?: boolean): string;
export declare function renderScopeChanges(page: ScopeChangePage): string;
export declare function renderScopeChange(c: ScopeChange, verb: string): string;
export declare function renderBurnup(b: Burnup): string;
export declare function renderRebuild(r: RebuildResult): string;
//# sourceMappingURL=renderProgress.d.ts.map