import { ApiDate } from '../../utils/cliHelpers';
import { QueueCounts } from './render';
import { MyProduct, TaskGroupCounts } from './renderViews';
export interface Activity {
    type?: string | null;
    at?: ApiDate;
    taskId?: number | null;
    taskName?: string | null;
    text?: string | null;
    actor?: string | null;
}
/** `GET /workspace/overview`. Each block is null when it failed to load (its name is then in `degraded`). */
export interface Overview {
    queue?: QueueCounts | null;
    tasks?: TaskGroupCounts | null;
    products?: MyProduct[] | null;
    recentActivity?: Activity[] | null;
    degraded?: string[] | null;
}
export declare function renderOverview(o: Overview): string;
//# sourceMappingURL=renderOverview.d.ts.map