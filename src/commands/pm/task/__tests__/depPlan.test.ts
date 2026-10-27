import { describe, it, expect } from 'vitest';
import { addPredecessors, removePredecessors, parseDepType, MAX_PREDECESSORS } from '../depPlan';

const p = (taskId: number, dependencyType = 'finish_to_start') => ({ taskId, dependencyType });

describe('parseDepType', () => {
  it('defaults to finish_to_start', () => expect(parseDepType(undefined)).toBe('finish_to_start'));
  it('accepts start_to_start', () => expect(parseDepType('start_to_start')).toBe('start_to_start'));
  it('rejects unknown types', () => expect(() => parseDepType('x')).toThrow('--type'));
});

describe('addPredecessors', () => {
  it('appends new ids and keeps existing order', () => {
    const r = addPredecessors([p(1)], [3, 2], 'finish_to_start');
    expect(r.next.map((x) => x.taskId)).toEqual([1, 3, 2]);
    expect(r.changed).toBe(true);
  });
  it('is a no-op when the id is already there with the same type', () => {
    const r = addPredecessors([p(1)], [1], 'finish_to_start');
    expect(r.changed).toBe(false);
    expect(r.next).toEqual([p(1)]);
  });
  it('changes the type of an existing predecessor', () => {
    const r = addPredecessors([p(1)], [1], 'start_to_start');
    expect(r.next).toEqual([p(1, 'start_to_start')]);
    expect(r.changed).toBe(true);
  });
  it('does not mutate the input', () => {
    const cur = [p(1)];
    addPredecessors(cur, [2], 'finish_to_start');
    expect(cur).toEqual([p(1)]);
  });
  it('refuses to exceed the backend limit', () => {
    const cur = Array.from({ length: MAX_PREDECESSORS }, (_, i) => p(i + 1));
    expect(() => addPredecessors(cur, [999], 'finish_to_start')).toThrow('最多');
  });
});

describe('removePredecessors', () => {
  it('removes listed ids', () => {
    expect(removePredecessors([p(1), p(2), p(3)], [2]).next.map((x) => x.taskId)).toEqual([1, 3]);
  });
  it('reports ids that were not predecessors', () => {
    const r = removePredecessors([p(1)], [1, 9]);
    expect(r.next).toEqual([]);
    expect(r.missing).toEqual([9]);
  });
});
