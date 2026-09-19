import { ApiDate } from '../../utils/cliHelpers';
export interface IdeaKpi {
    name?: string | null;
    current?: string | null;
    target?: string | null;
    unit?: string | null;
}
export interface IdeaSolution {
    id: number;
    ideaId?: number;
    name?: string | null;
    description?: string | null;
    costNote?: string | null;
    cycleNote?: string | null;
    expectedEffectNote?: string | null;
    isSelected?: boolean | null;
    decisionReason?: string | null;
    decidedBy?: number | null;
    decidedAt?: ApiDate;
    effortDaysFrontend?: number | null;
    effortDaysBackend?: number | null;
    effortDaysAi?: number | null;
    effortDaysTest?: number | null;
    effortDaysPm?: number | null;
    totalEffortDays?: number | null;
    estimatedCost?: number | null;
    cloudCostMonthly?: number | null;
    aiTokenCostMonthly?: number | null;
    maintenanceCost?: number | null;
    cycleWeeks?: number | null;
    technicalRisk?: string | null;
    productRisk?: string | null;
    expectedEffect?: string | null;
    kpi?: IdeaKpi[] | null;
    confidence?: string | null;
    estimationSource?: string | null;
    rejectionReason?: string | null;
}
export interface IdeaDecision {
    id?: number | null;
    ideaId?: number;
    selectedSolutionId?: number | null;
    decidedBy?: number | null;
    decidedAt?: ApiDate;
    reason?: string | null;
    approvalStatus?: string | null;
    approvalId?: number | null;
}
/** Solutions as columns, estimate dimensions as rows. Empty when no solution carries any estimate. */
export declare function renderEstimateComparison(solutions: IdeaSolution[]): string[];
/** Decision line: from the decision row when there is one, else from the solution flagged selected (MVP). */
export declare function renderDecision(solutions: IdeaSolution[], decision?: IdeaDecision | null): string[];
export declare function renderSolutions(solutions: IdeaSolution[], decision?: IdeaDecision | null): string[];
//# sourceMappingURL=renderSolutions.d.ts.map