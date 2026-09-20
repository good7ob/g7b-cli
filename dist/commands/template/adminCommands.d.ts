import { Command } from 'commander';
/**
 * The admin endpoints sit behind AdminAuthInterceptor: only a Bearer token whose userType is `admin` (a Cognito
 * admin-pool ID token, or a backend JWT for a sys_user) gets through. The CLI has no separate admin-credential
 * setting — it sends the one configured token, so an ordinary api-key / MCP key is refused with HTTP 403.
 */
export declare const ADMIN_HINT: string;
/** Add the auth pointer to a "not an admin" rejection (HTTP 403 with no code, or business code 2000). */
export declare function withAdminHint(error: unknown): unknown;
/** `template admin ...`: platform-admin moderation of PUBLIC submissions (api-0091 §8). */
export declare function registerAdminCommands(tpl: Command): void;
//# sourceMappingURL=adminCommands.d.ts.map