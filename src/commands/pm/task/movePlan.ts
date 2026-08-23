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

export type IssueCode =
  | 'ALREADY_IN_TARGET'
  | 'DEADLINE_AFTER_PROJECT_END'
  | 'PARENT_LEFT_BEHIND'
  | 'SUBTASKS_LEFT_BEHIND';

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

export function planMove(tasks: TaskLike[], target: ProjectLike, options: MoveOptions = {}): MovePlan {
  const movingIds = new Set(tasks.map((t) => t.id));
  const parentProjectIds = options.parentProjectIds || {};

  const moves: PlannedMove[] = [];
  const issues: MoveIssue[] = [];
  let hardError = false;

  const fail = (taskId: number, code: IssueCode, message: string) => {
    issues.push({ taskId, level: options.force ? 'warning' : 'error', code, message });
    if (!options.force) hardError = true;
  };

  for (const task of tasks) {
    if (task.projectId === target.id) {
      issues.push({
        taskId: task.id,
        level: 'warning',
        code: 'ALREADY_IN_TARGET',
        message: `任务 ${task.id} 已在项目 ${target.id}，跳过`,
      });
      continue;
    }

    let taskBlocked = false;

    if (task.deadline && target.endDate && task.deadline > target.endDate) {
      fail(
        task.id,
        'DEADLINE_AFTER_PROJECT_END',
        `任务 ${task.id} 的截止日期 ${task.deadline} 晚于目标项目结束日期 ${target.endDate}`
      );
      taskBlocked = !options.force;
    }

    if (task.parentTaskId && !movingIds.has(task.parentTaskId)) {
      const parentProject = parentProjectIds[task.parentTaskId];
      if (parentProject !== target.id) {
        fail(
          task.id,
          'PARENT_LEFT_BEHIND',
          `任务 ${task.id} 的父任务 ${task.parentTaskId} 不在本次移动范围内，移动后会形成跨项目悬挂引用`
        );
        taskBlocked = !options.force;
      }
    }

    const strandedSubTasks = (task.subTasks || []).filter((s) => !movingIds.has(s.id));
    if (strandedSubTasks.length) {
      issues.push({
        taskId: task.id,
        level: 'warning',
        code: 'SUBTASKS_LEFT_BEHIND',
        message: `任务 ${task.id} 的子任务 ${strandedSubTasks
          .map((s) => s.id)
          .join(', ')} 会留在原项目，可加 --with-subtasks 一并移动`,
      });
    }

    if (!taskBlocked) {
      moves.push({ taskId: task.id, name: task.name, fromProjectId: task.projectId });
    }
  }

  return { moves, issues, blocked: hardError };
}
