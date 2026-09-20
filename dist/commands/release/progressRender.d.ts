import { ApiDate } from '../../utils/cliHelpers';
import { ScopeKpi } from '../pm/health/kpi';
/** GET /progress/releases/{id}/health — the shared scope KPIs restricted to one release. */
export interface ReleaseHealth extends ScopeKpi {
    releaseId?: number | null;
    productId?: number | null;
    releaseName?: string | null;
    version?: string | null;
    status?: string | null;
    totalTasks?: number | null;
    completedTasks?: number | null;
    asOf?: ApiDate;
}
/** POST /progress/releases/{id}/baseline */
export interface ReleaseBaseline {
    baselineId?: number | null;
    releaseId?: number | null;
    baselineScope?: number | null;
    baselineTaskCount?: number | null;
    weightBasis?: string | null;
    note?: string | null;
    setBy?: number | null;
    setAt?: ApiDate;
}
export declare function renderReleaseHealth(h: ReleaseHealth): string;
export declare function renderReleaseBaseline(b: ReleaseBaseline): string;
//# sourceMappingURL=progressRender.d.ts.map