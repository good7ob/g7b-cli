import { describe, expect, it } from 'vitest';
import { parseLongId } from '../cliHelpers';

describe('parseLongId', () => {
  it('keeps a safe integer as a number', () => expect(parseLongId('2018', 'id')).toBe(2018));
  it('returns an id beyond 2^53 as the exact string', () =>
    expect(parseLongId(' 2114603713357754370 ', 'id')).toBe('2114603713357754370'));
  it('accepts the Java Long maximum', () => expect(parseLongId('9223372036854775807', 'id')).toBe('9223372036854775807'));
  it.each(['0', '-1', '01', '1.5', 'abc', '', '9223372036854775808', '99999999999999999999'])('rejects %s', (raw) =>
    expect(() => parseLongId(raw, '--id')).toThrow('--id'));
  it('rejects a missing value', () => expect(() => parseLongId(undefined, '--id')).toThrow('(空)'));
});
