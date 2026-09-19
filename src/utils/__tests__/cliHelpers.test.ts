import { describe, expect, it, vi } from 'vitest';
import {
  AI_REQUEST_CONFIG, DASH, InputError, checkMaxLength, describeError, dash, fmtDate, fmtNum, parseId, parseIntInRange, requireOneOf, requireText, renderTable, stripControl, emit, withTimeoutHint,
} from '../cliHelpers';

describe('formatting', () => {
  it('renders null/undefined/empty as an em dash but keeps a real zero', () => {
    expect(dash(null)).toBe(DASH);
    expect(dash(undefined)).toBe(DASH);
    expect(dash('')).toBe(DASH);
    expect(dash(0)).toBe('0');
    expect(fmtNum(null)).toBe(DASH);
    expect(fmtNum(undefined, '%')).toBe(DASH);
    expect(fmtNum(0, '%')).toBe('0%');
  });

  it('rounds and drops trailing zeros', () => {
    expect(fmtNum(12, '', 1)).toBe('12');
    expect(fmtNum(38.256, '%')).toBe('38.26%');
    expect(fmtNum(42.54, '%', 1)).toBe('42.5%');
  });
});

describe('fmtDate', () => {
  it('passes ISO strings through and normalises the [y,m,d,h,mi,s,nanos] array form', () => {
    expect(fmtDate('2026-09-19T10:00:00')).toBe('2026-09-19T10:00:00');
    expect(fmtDate([2026, 8, 24, 14, 18, 43, 705186000])).toBe('2026-08-24 14:18:43');
    expect(fmtDate([2026, 10, 1])).toBe('2026-10-01');
    expect(fmtDate([2026, 8, 24, 9, 5])).toBe('2026-08-24 09:05:00');
    expect(fmtDate(null)).toBe(DASH);
    expect(fmtDate([])).toBe(DASH);
  });
});

describe('validation', () => {
  it('parseId accepts positive integers only', () => {
    expect(parseId(' 42 ', 'id')).toBe(42);
    for (const bad of ['0', '-1', '1.5', 'abc', '12abc', '']) {
      expect(() => parseId(bad, 'id')).toThrow(InputError);
    }
    expect(() => parseId(undefined, 'id')).toThrow(InputError);
  });

  it('parseIntInRange enforces bounds', () => {
    expect(parseIntInRange('50', '--limit', 1, 200)).toBe(50);
    expect(() => parseIntInRange('0', '--limit', 1, 200)).toThrow('1 到 200');
    expect(() => parseIntInRange('201', '--limit', 1, 200)).toThrow(InputError);
    expect(() => parseIntInRange('x', '--limit', 1, 200)).toThrow('必须是整数');
  });

  it('requireOneOf lists the allowed values', () => {
    expect(requireOneOf('a', ['a', 'b'] as const, 'x')).toBe('a');
    expect(() => requireOneOf('c', ['a', 'b'] as const, 'x')).toThrow('a | b');
  });

  it('text limits count characters, and blank text is rejected', () => {
    expect(checkMaxLength('a'.repeat(200), 200, 't')).toHaveLength(200);
    expect(() => checkMaxLength('a'.repeat(201), 200, 't')).toThrow('最多 200');
    expect(() => requireText('   ', 10, 't')).toThrow('不能为空');
    expect(() => requireText(undefined, 10, 't')).toThrow(InputError);
  });
});

describe('describeError', () => {
  const businessError = (code: number, msg: string) => Object.assign(new Error(msg), { code });

  it('maps a known code and keeps the server message', () => {
    const text = describeError(businessError(1007, 'idea is approved'), { 1007: '状态不允许' });
    expect(text).toContain('状态不允许');
    expect(text).toContain('1007');
    expect(text).toContain('idea is approved');
  });

  it('maps auth codes without a per-command map', () => {
    expect(describeError(businessError(999, 'x'))).toContain('未登录');
    expect(describeError(businessError(401, 'x'))).toContain('未登录');
  });

  it('falls back to message + code for unknown codes and plain message otherwise', () => {
    expect(describeError(businessError(1234, 'weird'))).toBe('weird (code=1234)');
    expect(describeError(new Error('Network Error'))).toBe('Network Error');
    expect(describeError('str')).toBe('str');
  });
});

describe('AI request helpers', () => {
  it('AI calls get a client timeout of at least 120 s', () => {
    expect(AI_REQUEST_CONFIG.timeout).toBeGreaterThanOrEqual(120_000);
  });

  it('withTimeoutHint only decorates timeouts', () => {
    const timeout = withTimeoutHint(new Error('timeout of 180000ms exceeded'), '别重试') as Error;
    expect(timeout.message).toBe('timeout of 180000ms exceeded（别重试）');
    const other = new Error('boom');
    expect(withTimeoutHint(other, '别重试')).toBe(other);
    expect((withTimeoutHint('Timeout!', 'h') as Error).message).toBe('Timeout!（h）');
    // gateway failures on a long call are as ambiguous as a timeout
    expect((withTimeoutHint(new Error('Request failed with status code 504'), 'h') as Error).message).toContain('（h）');
    expect((withTimeoutHint(new Error('socket hang up'), 'h') as Error).message).toContain('（h）');
    expect(withTimeoutHint(new Error('Request failed with status code 404'), 'h')).toBeInstanceOf(Error);
    expect((withTimeoutHint(new Error('Request failed with status code 404'), 'h') as Error).message).not.toContain('（h）');
    // a business error keeps its code (and its mapping) even if its message says "timeout"
    const business = Object.assign(new Error('AI timeout'), { code: 1001 });
    expect(withTimeoutHint(business, 'h')).toBe(business);
  });
});

describe('untrusted text', () => {
  it('stripControl removes escape sequences and control characters but keeps newlines, tabs and CJK', () => {
    expect(stripControl('a\x1b[31mred\x1b[0m b\x1b]0;evil title\x07c\x1b]8;;http://x\x1b\\link\r\nline2\tend\x00\x7f')).toBe('ared bclink\nline2\tend');
    expect(stripControl('# 周报 · 进度 ✓')).toBe('# 周报 · 进度 ✓');
  });

  it('emit strips control characters from text output but leaves --json untouched', () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    emit(false, {}, () => 'ok\x1b[2J\x1b[Hbye');
    emit(true, { title: 'a\x1b[31mb' }, () => 'unused');
    spy.mockRestore();
    expect(lines[0]).toBe('okbye');
    expect(JSON.parse(lines[1]).title).toBe('a\x1b[31mb');
  });

  it('renderTable strips them too', () => {
    expect(renderTable([['x', 'y\x1b[31m!']])).not.toContain('\x1b');
  });
});
