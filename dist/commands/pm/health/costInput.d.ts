/**
 * CLI-boundary validation for the C2 budget / cost-entry commands (backend CostSupport,
 * ProductBudgetService, CostEntryService — api-0090 §9). Limits mirror the backend so a bad value
 * is rejected here with a clear message instead of as a 1001 round-trip. Unlike the backend, which
 * silently rounds to cents, the CLI refuses more than 2 decimals so a typo is not stored as a different amount.
 */
import { ErrorCodeMap } from '../../../utils/cliHelpers';
/** Business codes of every C2 endpoint (Result envelope: HTTP 200 + non-200 `code`). */
export declare const INTEL_ERROR_CODES: ErrorCodeMap;
export declare const COST_CATEGORIES: readonly ["labor", "cloud", "ai_token", "other"];
export declare const MAX_AMOUNT = 9999999999.99;
export declare const MAX_LABOR_RATE = 100000;
export declare const MAX_TOKEN_PRICE = 100000;
export declare const MIN_ENTRY_DATE = "2000-01-01";
/** A positive amount with at most 2 decimals, up to `max`. */
export declare function parseMoney(raw: string | undefined, label: string, max: number): number;
/** Money per 1,000,000 tokens: 0 (a free model) to 100000, at most 4 decimals (the backend rounds to 4; the CLI refuses more). */
export declare function parseTokenPrice(raw: string | undefined, label?: string): number;
/** Upper-cased 3-letter currency code. */
export declare function parseCurrency(raw: string | undefined, label?: string): string;
/** Day the cost was incurred: a real date from 2000-01-01 up to tomorrow (UTC), as the backend allows. */
export declare function parseIncurredOn(raw: string | undefined, now?: Date): string;
export declare const releaseParams: (release?: string) => Record<string, number>;
export interface BudgetOptions {
    amount?: string;
    currency?: string;
    laborRate?: string;
    tokenPricePerMillion?: string;
    clearTokenPrice?: boolean;
    note?: string;
    release?: string;
}
export declare function buildBudgetBody(o: BudgetOptions): Record<string, unknown>;
export interface CostEntryOptions extends BudgetOptions {
    category?: string;
    date?: string;
}
/** POST and PUT share this body; PUT replaces the whole entry, so an omitted --release / --note clears it. */
export declare function buildCostEntryBody(o: CostEntryOptions, now?: Date): {
    note?: string;
    category: "labor" | "cloud" | "ai_token" | "other";
    amount: number;
    currency: string;
    incurredOn: string;
};
export interface CostEntryListOptions {
    release?: string;
    category?: string;
    from?: string;
    to?: string;
    page?: string;
    pageSize?: string;
}
export declare function buildCostEntryListParams(o: CostEntryListOptions): Record<string, string | number>;
//# sourceMappingURL=costInput.d.ts.map