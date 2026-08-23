/**
 * Pre-flight validation for moving tasks between projects.
 *
 * The backend accepts a projectId change on PUT /progress/tasks/{id} but does
 * not validate it: TaskService.saveOrUpdateTask only runs its deadline guard
 * when the request body carries a deadline, so a move-only payload slips past
 * it, and nothing re-parents or checks sub-tasks. These checks live here so the
 * CLI refuses the obviously broken moves before issuing any write.
 */
export interface SubTaskRef {
    id: number;
}
export interface TaskLike {
    id: number;
    name: string;
    projectId: number;
    deadline?: string | null;
    parentTaskId?: number | null;
    subTasks?: SubTaskRef[] | null;
}
export interface ProjectLike {
    id: number;
    name: string;
    endDate?: string | null;
}
export interface MoveOptions {
    /** Downgrade every error to a non-blocking issue. */
    force?: boolean;
    /** Known project of a parent task that is not part of this batch. */
    parentProjectIds?: Record<number, number>;
}
export type IssueLevel = 'error' | 'warning';
export type IssueCode = 'ALREADY_IN_TARGET' | 'DEADLINE_AFTER_PROJECT_END' | 'PARENT_LEFT_BEHIND' | 'SUBTASKS_LEFT_BEHIND';
export interface MoveIssue {
    taskId: number;
    level: IssueLevel;
    code: IssueCode;
    message: string;
}
export interface PlannedMove {
    taskId: number;
    name: string;
    fromProjectId: number;
}
export interface MovePlan {
    moves: PlannedMove[];
    issues: MoveIssue[];
    /** True when an unforced error means nothing should be written. */
    blocked: boolean;
}
export declare function planMove(tasks: TaskLike[], target: ProjectLike, options?: MoveOptions): MovePlan;
//# sourceMappingURL=movePlan.d.ts.map