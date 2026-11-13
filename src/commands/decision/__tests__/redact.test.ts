import { describe, expect, it } from 'vitest';
import { redact } from '../redact';

describe('redact (api-0189 §1 R1~R7)', () => {
  it('R1 AWS access key', () => {
    expect(redact('key AKIAABCDEFGHIJKLMNOP end')).toBe('key [AWS_KEY] end');
    expect(redact('AKIASHORT')).toBe('AKIASHORT');
  });
  it('R2 sk- API key (20+ chars, word boundary)', () => {
    expect(redact('sk-abcdefghijklmnopqrstuvwx')).toBe('[API_KEY]');
    expect(redact('sk-short')).toBe('sk-short');
    expect(redact('task-abcdefghijklmnopqrstuvwx')).toBe('task-abcdefghijklmnopqrstuvwx');
  });
  it('R3 bearer token, case-insensitive, needs 20+ token chars', () => {
    expect(redact('Authorization: bearer abcdefghijklmnopqrstu.v-w_x')).toBe('Authorization: Bearer [TOKEN]');
    expect(redact('BEARER ABCDEFGHIJKLMNOPQRSTUVWX')).toBe('Bearer [TOKEN]');
    expect(redact('bearer short')).toBe('bearer short');
  });
  it('R4 keeps key and separator, hides the value', () => {
    expect(redact('password=hunter2 ok')).toBe('password=[REDACTED] ok');
    expect(redact('Secret : abc')).toBe('Secret : [REDACTED]');
    expect(redact('TOKEN:xyz')).toBe('TOKEN:[REDACTED]');
    expect(redact('passwd = p@ss')).toBe('passwd = [REDACTED]');
  });
  it('R5 JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
    expect(redact(`t ${jwt} t`)).toBe('t [JWT] t');
  });
  it('R6 home directories on macOS, Linux and Windows', () => {
    expect(redact('see /Users/alice/Documents/x and /home/bob/y and C:\\Users\\carol\\z')).toBe(
      'see /Users/[USER]/Documents/x and /home/[USER]/y and C:\\Users\\[USER]\\z'
    );
  });
  it('R7 dash-encoded paths', () => {
    expect(redact('/tmp/claude-501/-Users-alice-Documents-work-x')).toBe('/tmp/claude-501/-Users-[USER]-Documents-work-x');
    expect(redact('-home-bob-src')).toBe('-home-[USER]-src');
  });
  it('R7 known limit: a dashed user name leaves its tail', () => {
    expect(redact('-Users-mary-ann-Documents')).toBe('-Users-[USER]-ann-Documents');
  });
  it('is idempotent and leaves plain text alone', () => {
    const once = redact('/Users/alice/a -Users-alice-x password=x AKIAABCDEFGHIJKLMNOP');
    expect(redact(once)).toBe(once);
    expect(redact('首发范围按哪个来起草？')).toBe('首发范围按哪个来起草？');
  });
});
