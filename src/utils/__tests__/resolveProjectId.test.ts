import { describe, it, expect } from 'vitest';
import { resolveProjectId } from '../resolveProjectId';

describe('resolveProjectId', () => {
  it('prefers explicit, then env, then config', () => {
    expect(resolveProjectId('5', 9, { GOOD7OB_PROJECT_ID: '7' })).toEqual({ id: 5, fromDefault: false });
    expect(resolveProjectId(undefined, 9, { GOOD7OB_PROJECT_ID: '7' })).toEqual({ id: 7, fromDefault: true });
    expect(resolveProjectId(undefined, 9, {})).toEqual({ id: 9, fromDefault: true });
  });

  it('throws when nothing valid is set', () => {
    expect(() => resolveProjectId(undefined, undefined, {})).toThrow(/缺少项目/);
    expect(() => resolveProjectId('abc', 9, {})).toThrow(/缺少项目/);
    expect(() => resolveProjectId('0', undefined, {})).toThrow(/缺少项目/);
  });
});
