/**
 * CLI-boundary validation for solution flags (IdeaSolutionCreateDto / IdeaSolutionUpdateDto +
 * IdeaSolutionEstimateDto). Ranges, decimal places and lengths mirror the backend's
 * IdeaSolutionFields so a bad value fails here instead of as a 1001 round-trip.
 */
export declare const LEVELS: readonly ["low", "medium", "high"];
export declare const ESTIMATION_SOURCES: readonly ["manual", "ai"];
/** Non-negative decimal with at most `scale` places (trailing zeros don't count) and <= max. */
export declare function parseDecimal(raw: string, label: string, scale: number, max: number): number;
/** `name[:current[:target[:unit]]]` -> a KPI object with only the parts that were given. */
export declare function parseKpi(raw: string): Record<string, string>;
export interface SolutionFlags {
    name?: string;
    description?: string;
    costNote?: string;
    cycleNote?: string;
    effectNote?: string;
    effortFrontend?: string;
    effortBackend?: string;
    effortAi?: string;
    effortTest?: string;
    effortPm?: string;
    cost?: string;
    cloudCost?: string;
    tokenCost?: string;
    maintenanceCost?: string;
    cycleWeeks?: string;
    technicalRisk?: string;
    productRisk?: string;
    confidence?: string;
    estimationSource?: string;
    expectedEffect?: string;
    kpi?: string[];
    clearKpi?: boolean;
}
type Body = Record<string, unknown>;
export declare function buildSolutionCreateBody(o: SolutionFlags): Body;
/** Omitted flag = field unchanged (backend contract), so only send what was given. `--kpi` replaces the whole list. */
export declare function buildSolutionUpdateBody(o: SolutionFlags): Body;
export {};
//# sourceMappingURL=solutionInput.d.ts.map