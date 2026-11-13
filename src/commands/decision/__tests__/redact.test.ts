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

describe('redact R8 / R9 (api-0189 1.1.0)', () => {
  // 令牌形态运行时拼接，避免源码里出现完整字面量
  const ghp = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0' + 'k1L2m3N4';
  it('R8 GitHub tokens', () => {
    expect(redact(`use ${ghp} now`)).toBe('use [GITHUB_TOKEN] now');
    for (const p of ['gho_', 'ghu_', 'ghs_', 'ghr_']) expect(redact(p + 'x'.repeat(24))).toBe('[GITHUB_TOKEN]');
    expect(redact('github_pat_' + 'A1b2C3d4_E5f6G7h8i9J0k1')).toBe('[GITHUB_TOKEN]');
    expect(redact('ghp_short')).toBe('ghp_short');
    expect(redact('xghp_' + 'a'.repeat(24))).toBe('xghp_' + 'a'.repeat(24));
  });
  it('R9 long mixed-case alphanumeric strings with a digit', () => {
    const secret = 'Ab1' + 'cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1w';
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(redact(`key ${secret} end`)).toBe('key [SECRET] end');
    expect(redact('Ab1' + 'x'.repeat(28))).toBe('Ab1' + 'x'.repeat(28)); // 31 位
    expect(redact('Ab1' + 'x'.repeat(29))).toBe('[SECRET]'); // 32 位
  });
  it('R9 needs upper, lower and digit; neighbours must not be alphanumeric', () => {
    expect(redact('a'.repeat(40))).toBe('a'.repeat(40));
    expect(redact('A'.repeat(20) + 'a'.repeat(20))).toBe('A'.repeat(20) + 'a'.repeat(20)); // 无数字
    expect(redact('Ab' + '1'.repeat(40) + '-tail')).toBe('[SECRET]-tail');
    expect(redact('Ab1' + 'x'.repeat(30) + '_z')).toBe('[SECRET]_z');
  });
  it('R9 does not touch a lowercase hex commit SHA', () => {
    const sha = '3f786850e387550fdab836ed7e6dc881de23001b';
    expect(sha).toHaveLength(40);
    expect(redact(`commit ${sha}`)).toBe(`commit ${sha}`);
  });
  it('R9 stays linear on a 200k mixed alphanumeric string', () => {
    const big = 'Ab1'.repeat(66_000) + 'x';
    const t = Date.now();
    expect(redact(big)).toBe('[SECRET]');
    expect(Date.now() - t).toBeLessThan(1000);
    const near = 'Ab'.repeat(100_000); // 无数字：不命中，同样要快
    const t2 = Date.now();
    expect(redact(near)).toBe(near);
    expect(Date.now() - t2).toBeLessThan(1000);
  });
  it('R8/R9 are idempotent and run after R1~R7', () => {
    const once = redact(`${ghp} Ab1${'x'.repeat(30)} password=x`);
    expect(once).toBe('[GITHUB_TOKEN] [SECRET] password=[REDACTED]');
    expect(redact(once)).toBe(once);
  });
});
