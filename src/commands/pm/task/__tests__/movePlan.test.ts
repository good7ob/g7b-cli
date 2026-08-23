import { describe, it, expect } from 'vitest';
import { planMove, TaskLike, ProjectLike } from '../movePlan';

const target: ProjectLike = { id: 450, name: '目标项目', endDate: '2026-12-31' };

const task = (over: Partial<TaskLike> = {}): TaskLike => ({
  id: 1,
  name: '任务一',
  projectId: 4,
  deadline: null,
  parentTaskId: null,
  subTasks: [],
  ...over,
});

describe('planMove', () => {
  it('单个普通任务可以直接移动，无 issue', () => {
    const plan = planMove([task()], target, {});
    expect(plan.moves).toEqual([{ taskId: 1, name: '任务一', fromProjectId: 4 }]);
    expect(plan.issues).toHaveLength(0);
    expect(plan.blocked).toBe(false);
  });

  it('任务已在目标项目时跳过，并给出 warning', () => {
    const plan = planMove([task({ projectId: 450 })], target, {});
    expect(plan.moves).toHaveLength(0);
    expect(plan.issues).toEqual([
      expect.objectContaining({ taskId: 1, level: 'warning', code: 'ALREADY_IN_TARGET' }),
    ]);
    expect(plan.blocked).toBe(false);
  });

  it('deadline 晚于目标项目结束日期时报 error 并阻断', () => {
    const plan = planMove([task({ deadline: '2027-01-15' })], target, {});
    expect(plan.moves).toHaveLength(0);
    expect(plan.issues[0]).toMatchObject({ level: 'error', code: 'DEADLINE_AFTER_PROJECT_END' });
    expect(plan.blocked).toBe(true);
  });

  it('deadline 等于目标项目结束日期时允许移动', () => {
    const plan = planMove([task({ deadline: '2026-12-31' })], target, {});
    expect(plan.issues).toHaveLength(0);
    expect(plan.moves).toHaveLength(1);
  });

  it('目标项目无结束日期时不做 deadline 校验', () => {
    const plan = planMove([task({ deadline: '2099-01-01' })], { id: 450, name: 'x', endDate: null }, {});
    expect(plan.issues).toHaveLength(0);
    expect(plan.moves).toHaveLength(1);
  });

  it('force 可以放行 deadline 冲突，但 issue 仍然保留', () => {
    const plan = planMove([task({ deadline: '2027-01-15' })], target, { force: true });
    expect(plan.moves).toHaveLength(1);
    expect(plan.issues[0].code).toBe('DEADLINE_AFTER_PROJECT_END');
    expect(plan.blocked).toBe(false);
  });

  it('父任务留在原项目时报 error（悬挂引用）', () => {
    const plan = planMove([task({ parentTaskId: 99 })], target, {});
    expect(plan.issues[0]).toMatchObject({ level: 'error', code: 'PARENT_LEFT_BEHIND' });
    expect(plan.blocked).toBe(true);
  });

  it('父任务与子任务一起移动时不报错', () => {
    const parent = task({ id: 99, name: '父任务' });
    const child = task({ id: 1, parentTaskId: 99 });
    const plan = planMove([parent, child], target, {});
    expect(plan.issues).toHaveLength(0);
    expect(plan.moves).toHaveLength(2);
  });

  it('父任务已经在目标项目时不报错', () => {
    const plan = planMove([task({ parentTaskId: 99 })], target, { parentProjectIds: { 99: 450 } });
    expect(plan.issues).toHaveLength(0);
    expect(plan.moves).toHaveLength(1);
  });

  it('子任务被留在原项目时给出 warning，不阻断', () => {
    const plan = planMove([task({ subTasks: [{ id: 7 }, { id: 8 }] })], target, {});
    expect(plan.issues[0]).toMatchObject({ level: 'warning', code: 'SUBTASKS_LEFT_BEHIND' });
    expect(plan.issues[0].message).toContain('7');
    expect(plan.blocked).toBe(false);
    expect(plan.moves).toHaveLength(1);
  });

  it('子任务一并移动时不给 warning', () => {
    const parent = task({ id: 1, subTasks: [{ id: 7 }] });
    const child = task({ id: 7, parentTaskId: 1 });
    const plan = planMove([parent, child], target, {});
    expect(plan.issues).toHaveLength(0);
    expect(plan.moves).toHaveLength(2);
  });

  it('多个任务混合场景：各自独立判定', () => {
    const plan = planMove(
      [task({ id: 1 }), task({ id: 2, projectId: 450 }), task({ id: 3, deadline: '2027-06-01' })],
      target,
      {}
    );
    expect(plan.moves.map((m) => m.taskId)).toEqual([1]);
    expect(plan.issues.map((i) => i.code).sort()).toEqual([
      'ALREADY_IN_TARGET',
      'DEADLINE_AFTER_PROJECT_END',
    ]);
    expect(plan.blocked).toBe(true);
  });
});
