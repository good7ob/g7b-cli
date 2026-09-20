/**
 * CLI-boundary validation for `release` commands. Limits mirror ReleaseService /
 * ReleaseTaskService (name <= 200, version <= 50, 1..200 task ids per call) so a bad
 * value is rejected here with a clear message instead of as a 1001 round-trip.
 */
import { ErrorCodeMap } from '../../utils/cliHelpers';
export declare const STATUSES: readonly ["planned", "in_progress", "awaiting_approval", "released", "cancelled"];
export declare const MAX_NAME = 200;
export declare const MAX_VERSION = 50;
export declare const MAX_TASK_IDS = 200;
export declare const RELEASE_ERROR_CODES: ErrorCodeMap;
interface ReleaseFlags {
    name?: string;
    version?: string;
    description?: string;
    start?: string;
    end?: string;
}
export declare function buildListParams(o: {
    product?: string;
    status?: string;
}): Record<string, string | number>;
export declare function buildCreateBody(o: ReleaseFlags & {
    product?: string;
}): Record<string, string | number>;
export declare function buildUpdateBody(o: ReleaseFlags): Record<string, string>;
export declare function buildRequestApprovalBody(description?: string): Record<string, string>;
export declare function buildTaskIdsBody(raw: string | undefined): {
    taskIds: number[];
};
export {};
//# sourceMappingURL=input.d.ts.map