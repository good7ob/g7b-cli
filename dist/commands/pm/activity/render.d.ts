import { ApiDate } from '../../../utils/cliHelpers';
/** ActivityVo as api-0092 returns it. */
export interface Activity {
    id?: number | null;
    projectId?: number | null;
    taskId?: number | null;
    taskName?: string | null;
    type?: string | null;
    actorType?: string | null;
    actorId?: string | number | null;
    actorName?: string | null;
    actorAvatarUrl?: string | null;
    channel?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    summary?: string | null;
    metadata?: Record<string, unknown> | null;
    createdAt?: ApiDate;
}
export interface ActivityPage {
    items?: Activity[] | null;
    nextSinceId?: number | null;
    hasMore?: boolean | null;
}
/** Table + the cursor footer; renderTable strips control characters from every cell (rp-pm-activity-0042). */
export declare function renderActivityList(page: ActivityPage): string;
//# sourceMappingURL=render.d.ts.map