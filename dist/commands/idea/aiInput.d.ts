/**
 * CLI-boundary validation for `idea generate` / `idea correction` (IdeaSolutionGenerateDto), plus the
 * AI-specific error codes and the long client timeout shared by every command that calls the model.
 */
import { ErrorCodeMap } from '../../utils/cliHelpers';
export declare const MIN_COUNT = 2;
export declare const MAX_COUNT = 4;
export declare const MAX_HINTS = 1000;
/** Model calls run synchronously server side; the ApiClient default (30 s) would cut them off. */
export declare const AI_TIMEOUT_MS = 180000;
/** A2 error codes (api-0088 §4): a failed AI call writes nothing and charges no tokens. */
export declare const AI_ERROR_CODES: ErrorCodeMap;
export declare const GENERATE_ERROR_CODES: ErrorCodeMap;
/** Only the flags that were given are sent; the backend defaults count to 3. */
export declare function buildGenerateBody(o: {
    count?: string;
    hints?: string;
}): Record<string, unknown>;
/** The server may still finish (and bill) a call the client gave up on — warn before a blind retry. */
export declare function withTimeoutHint(error: unknown, checkCommand: string): unknown;
//# sourceMappingURL=aiInput.d.ts.map