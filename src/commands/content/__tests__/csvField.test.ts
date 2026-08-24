import { describe, it, expect } from 'vitest';
import { csvField } from '../index';

describe('csvField', () => {
  it('returns empty string for null/undefined', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('passes through plain values unquoted', () => {
    expect(csvField('login.title')).toBe('login.title');
    expect(csvField(42)).toBe('42');
  });

  it('quotes values containing commas', () => {
    expect(csvField('欢迎, 朋友')).toBe('"欢迎, 朋友"');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvField('Pay "Now"')).toBe('"Pay ""Now"""');
  });

  it('quotes values containing newlines', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });
});
