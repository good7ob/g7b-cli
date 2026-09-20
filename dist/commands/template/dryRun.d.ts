/**
 * `template use --dry-run`: everything a real instantiation would check that the CLI can know, and nothing written.
 * Reads the template + version (GET), the dependency check (GET) and renders the content locally; never POSTs.
 * Membership of the org, ownership of the product / module / suite and the per-type structural validation of the
 * rendered result can only be judged by the server, so they are listed as not verified.
 */
import { DependencyCheckVo } from './renderCheck';
import { UseFlags } from './useInput';
import { VarMap } from './varsInput';
export interface DryRunReport {
    dryRun: true;
    ready: boolean;
    templateId: number;
    templateName?: string | null;
    templateType?: string | null;
    templateStatus?: string | null;
    version?: string | null;
    target: Record<string, unknown>;
    dependencies: DependencyCheckVo;
    variables: Record<string, string | number | boolean>;
    renderedContent: unknown;
    plan: string[];
    issues: string[];
    notes: string[];
}
export declare function dryRunInstantiate(id: number, o: UseFlags, body: Record<string, unknown>, variables: VarMap | undefined): Promise<DryRunReport>;
//# sourceMappingURL=dryRun.d.ts.map