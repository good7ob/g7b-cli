import { Command } from 'commander';
import { ErrorCodeMap } from '../../../utils/cliHelpers';
/**
 * Product health dashboard (/progress/products/{id}/health, prd-0080) plus the C1 progress
 * commands (config, scope changes, burnup, snapshots — see progressCommands.ts) and the C2 progress
 * intelligence commands (forecast, what-if, diagnosis, explain — forecastCommands.ts; cost, budget,
 * cost-entry — costCommands.ts; management reports — reportCommands.ts).
 * Needs org membership on the product. Not the same thing as
 * /forge/products/{id}/progress (requirement-structuring completeness).
 * These three (health, modules, baseline) keep the old 40480/40380/40080 error codes.
 */
export declare const HEALTH_ERROR_CODES: ErrorCodeMap;
export declare function registerHealthCommands(pmCommand: Command): void;
//# sourceMappingURL=index.d.ts.map