import { Command } from 'commander';
/** GET /api/v1/me/actor (prd-0092 rp-org-ai-emp-0069): who the configured key acts as — a person or an AI employee. */
export interface Actor {
    actorType?: string | null;
    userId?: number | null;
    channel?: string | null;
    employee?: {
        id?: number | null;
        orgId?: number | null;
        nickname?: string | null;
        mcpRole?: string | null;
        capabilityScope?: {
            tools?: string[] | null;
            productIds?: number[] | null;
        } | null;
    } | null;
}
export declare function renderActor(a: Actor): string;
export declare function registerWhoamiCommands(program: Command): void;
//# sourceMappingURL=index.d.ts.map