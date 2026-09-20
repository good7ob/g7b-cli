import { IdeaSolution } from './renderSolutions';
export interface DimensionCorrection {
    factor?: number | null;
    sampleSize?: number | null;
    insufficientHistory?: boolean | null;
}
export interface EstimationCorrection {
    productId?: number;
    effort?: DimensionCorrection | null;
    cycle?: DimensionCorrection | null;
    cost?: DimensionCorrection | null;
}
export interface GenerateResult {
    solutions?: IdeaSolution[] | null;
    correction?: EstimationCorrection | null;
    model?: string | null;
    tokensUsed?: number | null;
    estimationSource?: string | null;
}
/** Factor per dimension; < 3 historical samples means factor 1.000 = no correction applied. */
export declare function renderCorrectionTable(c: EstimationCorrection | null | undefined): string;
export declare function renderCorrection(c: EstimationCorrection): string;
export declare function renderGenerated(ideaId: number, result: GenerateResult): string;
//# sourceMappingURL=aiRender.d.ts.map