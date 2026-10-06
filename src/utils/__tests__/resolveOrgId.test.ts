import { describe, it, expect } from 'vitest';
import { resolveOrgId } from '../resolveOrgId';

describe('resolveOrgId', () => {
  it('prefers the option, then env, then config', () => {
    expect(resolveOrgId('5', 9, { GOOD7OB_ORG_ID: '7' })).toBe(5);
    expect(resolveOrgId(undefined, 9, { GOOD7OB_ORG_ID: '7' })).toBe(7);
    expect(resolveOrgId(undefined, 9, {})).toBe(9);
  });

  it('throws instead of falling back to all orgs when nothing is set', () => {
    expect(() => resolveOrgId(undefined, undefined, {})).toThrow(/缺少组织/);
    expect(() => resolveOrgId('abc', undefined, {})).toThrow(/缺少组织/);
    expect(() => resolveOrgId('0', undefined, {})).toThrow(/缺少组织/);
  });
});
