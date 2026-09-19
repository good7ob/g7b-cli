import { Command } from 'commander';
import { ErrorCodeMap } from '../../../utils/cliHelpers';
/**
 * Product health dashboard (/progress/products/{id}/health, prd-0080).
 * Needs org membership on the product. Not the same thing as
 * /forge/products/{id}/progress (requirement-structuring completeness).
 */
export declare const MAX_NOTE = 500;
export declare const HEALTH_ERROR_CODES: ErrorCodeMap;
export declare function registerHealthCommands(pmCommand: Command): void;
//# sourceMappingURL=index.d.ts.map