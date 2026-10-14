import { describe, expect, it } from 'vitest';
import { parseHours, toSource } from '../index';

describe('toSource', () => {
  it('maps CLI names to API enums', () => {
    expect(toSource('local-agent')).toBe('LOCAL_AGENT');
    expect(toSource('platform-agent')).toBe('PLATFORM_AGENT');
    expect(toSource(undefined)).toBe('LOCAL_AGENT');
  });

  it('rejects unknown sources', () => {
    expect(() => toSource('human')).toThrow('--source');
  });
});

describe('parseHours', () => {
  it('accepts positive numbers up to two decimal places', () => {
    expect(parseHours('12')).toBe(12);
    expect(parseHours('12.5')).toBe(12.5);
    expect(parseHours('0.25')).toBe(0.25);
  });

  it('rejects zero, negatives, overflow and extra decimals', () => {
    expect(() => parseHours('0')).toThrow('--hours');
    expect(() => parseHours('-1')).toThrow('--hours');
    expect(() => parseHours('10001')).toThrow('--hours');
    expect(() => parseHours('1.234')).toThrow('两位小数');
    expect(() => parseHours(undefined)).toThrow('--hours');
  });
});
