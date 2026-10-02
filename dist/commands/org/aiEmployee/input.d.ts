/**
 * CLI-boundary validation for `org ai-employee` (prd-0092 FP-8 / FP-9, api-0092): key actions,
 * the profile PATCH body (only the fields given are sent) and the shared error map.
 */
import { ErrorCodeMap } from '../../../utils/cliHelpers';
export declare const KEY_ACTIONS: readonly ["issue", "regenerate", "disable", "enable"];
export type KeyAction = typeof KEY_ACTIONS[number];
export declare const MCP_ROLES: readonly ["VIEWER", "DEVELOPER", "MANAGER"];
export declare const MAX_NICKNAME = 50;
export declare const MAX_PRODUCTS = 100;
export declare const AI_EMPLOYEE_ERROR_CODES: ErrorCodeMap;
export interface ProfileFlags {
    nickname?: string;
    role?: string;
    tools?: string;
    products?: string;
}
export interface CapabilityScope {
    tools?: string[];
    productIds?: number[];
}
export interface ProfileBody {
    nickname?: string;
    mcpRole?: string;
    capabilityScope?: CapabilityScope;
}
export declare function buildProfileBody(o: ProfileFlags): ProfileBody;
//# sourceMappingURL=input.d.ts.map