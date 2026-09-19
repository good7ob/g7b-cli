import { ApiDate } from '../../../utils/cliHelpers';
/** Fields the backend cannot always compute are nullable — rendered as "—", never 0. */
export interface ProductHealth {
    productId?: number | null;
    productName?: string | null;
    overallProgress?: number | null;
    plannedProgress?: number | null;
    scheduleVariance?: number | null;
    remainingWork?: number | null;
    totalTasks?: number | null;
    completedTasks?: number | null;
    riskLevel?: string | null;
    moduleCount?: number | null;
    asOf?: ApiDate;
    currentScopeWeight?: number | null;
    baselineScopeWeight?: number | null;
    scopeChange?: number | null;
    scopeGrowthPct?: number | null;
    baselineSetAt?: ApiDate;
    weightedProgress?: number | null;
    blockedWeight?: number | null;
    blockedWeightRatio?: number | null;
    aiCompletedWeight?: number | null;
    humanCompletedWeight?: number | null;
    aiContributionPct?: number | null;
}
export interface ModuleHealth {
    projectId?: number | null;
    moduleName?: string | null;
    ownerId?: number | null;
    ownerName?: string | null;
    actualProgress?: number | null;
    plannedProgress?: number | null;
    progressVariance?: number | null;
    delayDays?: number | null;
    expectedEndDate?: ApiDate;
    riskLevel?: string | null;
    totalTasks?: number | null;
    completedTasks?: number | null;
    blockedTasks?: number | null;
    weightedProgress?: number | null;
}
export interface Baseline {
    baselineId?: number | null;
    productId?: number | null;
    baselineScopeWeight?: number | null;
    baselineTaskCount?: number | null;
    note?: string | null;
    setBy?: number | null;
    setAt?: ApiDate;
}
export declare function renderHealth(h: ProductHealth): string;
export declare function renderModules(modules: ModuleHealth[]): string;
export declare function renderBaseline(b: Baseline): string;
//# sourceMappingURL=render.d.ts.map