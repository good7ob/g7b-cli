import { describe, expect, it } from 'vitest';
import { InputError } from '../../../utils/cliHelpers';
import { buildActionBody, buildQueueParams, parseSnoozeUntil } from '../input';
import { buildProductsParams, buildTasksParams } from '../viewInput';

const NOW = new Date('2026-09-19T10:00:00.500Z');

describe('parseSnoozeUntil', () => {
  it.each([
    ['2026-09-20T09:00:00Z', '2026-09-20T09:00:00Z'],
    ['2026-09-20T09:00', '2026-09-20T09:00:00Z'], // no offset = UTC, minutes only
    ['2026-09-20T09:00:00', '2026-09-20T09:00:00Z'], // no offset = UTC
    ['2026-09-20T17:00:00+08:00', '2026-09-20T09:00:00Z'],
    ['2026-09-20T04:00:00-05:00', '2026-09-20T09:00:00Z'],
    ['2026-09-20T09:00:00.123456Z', '2026-09-20T09:00:00Z'], // fraction dropped
    ['  2026-09-20T09:00:00Z  ', '2026-09-20T09:00:00Z'],
    ['+30m', '2026-09-19T10:30:00Z'],
    ['+2h', '2026-09-19T12:00:00Z'],
    ['+1d', '2026-09-20T10:00:00Z'],
    [' +2h ', '2026-09-19T12:00:00Z'],
    ['+30d', '2026-10-19T10:00:00Z'], // the limit itself is allowed
    ['2026-10-19T10:00:00Z', '2026-10-19T10:00:00Z'],
  ])('accepts %s -> %s', (raw, expected) => {
    expect(parseSnoozeUntil(raw, NOW)).toBe(expected);
  });

  it.each([
    [undefined, '不能为空'],
    ['', '不能为空'],
    ['   ', '不能为空'],
    ['tomorrow', '不是有效的时间'],
    ['2026-09-20', '不是有效的时间'], // date only
    ['09:00', '不是有效的时间'],
    ['2026-09-20 09:00:00', '不是有效的时间'], // space instead of T
    ['2026-09-20T09:00:00z', '不是有效的时间'],
    ['2026-09-20T09:00:00+0800', '不是有效的时间'],
    ['2026-02-30T10:00:00Z', '不是有效的时间'], // not a calendar day
    ['2026-13-01T10:00:00Z', '不是有效的时间'],
    ['2026-09-20T24:00:00Z', '不是有效的时间'],
    ['2026-09-20T09:60:00Z', '不是有效的时间'],
    ['2026-09-20T09:00:60Z', '不是有效的时间'],
    ['2026-09-20T09:00:00+19:00', '不是有效的时间'], // beyond ±18:00
    ['2026-09-20T09:00:00+08:60', '不是有效的时间'],
    ['+0m', '不是有效的时间'],
    ['+5x', '不是有效的时间'],
    ['+1.5h', '不是有效的时间'],
    ['-2h', '不是有效的时间'],
    ['2h', '不是有效的时间'],
    ['+', '不是有效的时间'],
    ['+1234567d', '不是有效的时间'],
  ])('rejects %j as malformed', (raw, message) => {
    expect(() => parseSnoozeUntil(raw, NOW)).toThrow(InputError);
    expect(() => parseSnoozeUntil(raw, NOW)).toThrow(message);
  });

  it.each(['2026-09-19T10:00:00Z', '2026-09-19T09:59:59Z', '2020-01-01T00:00:00Z', '2026-09-19T18:00:00+08:00'])(
    'rejects %s: not in the future', (raw) => {
      expect(() => parseSnoozeUntil(raw, NOW)).toThrow('必须晚于当前时间');
    });

  it.each(['+31d', '+721h', '+43201m', '2026-10-19T10:00:01Z', '2027-09-19T10:00:00Z'])(
    'rejects %s: more than 30 days ahead', (raw) => {
      expect(() => parseSnoozeUntil(raw, NOW)).toThrow('最多只能稍后 30 天');
    });

  it('a sub-second head start is not enough once truncated to whole seconds', () => {
    // 10:00:00.500 now; 10:00:00Z is in the past
    expect(() => parseSnoozeUntil('2026-09-19T10:00:00Z', NOW)).toThrow('必须晚于当前时间');
    expect(parseSnoozeUntil('2026-09-19T10:00:01Z', NOW)).toBe('2026-09-19T10:00:01Z');
  });
});

describe('buildQueueParams', () => {
  it('defaults to limit 50 and sends no filters', () => {
    expect(buildQueueParams({})).toEqual({ limit: 50 });
  });

  it('normalises case: status lower, action type upper', () => {
    expect(buildQueueParams({ status: ' In_Progress ', actionType: 'plan_approval', product: '12', limit: '200' }))
      .toEqual({ limit: 200, status: 'in_progress', actionType: 'PLAN_APPROVAL', productId: 12 });
  });

  it.each([
    [{ status: 'pending' }, '--status'],
    [{ status: '' }, '--status'],
    [{ actionType: 'TASK' }, '--action-type'],
    [{ product: '0' }, '--product'],
    [{ product: 'abc' }, '--product'],
    [{ limit: '201' }, '--limit'],
    [{ limit: '0' }, '--limit'],
  ])('rejects %j', (opts, label) => {
    expect(() => buildQueueParams(opts)).toThrow(label);
  });
});

describe('buildActionBody', () => {
  it('approve: comment optional, blank comment dropped', () => {
    expect(buildActionBody('approve', undefined)).toEqual({ action: 'approve' });
    expect(buildActionBody('approve', '  ')).toEqual({ action: 'approve' });
    expect(buildActionBody('approve', 'ok')).toEqual({ action: 'approve', comment: 'ok' });
  });

  it('reject: non-blank comment required', () => {
    expect(buildActionBody('reject', 'no scope')).toEqual({ action: 'reject', comment: 'no scope' });
    expect(() => buildActionBody('reject', undefined)).toThrow('--comment');
    expect(() => buildActionBody('reject', '   ')).toThrow('--comment');
  });
});

describe('buildTasksParams / buildProductsParams', () => {
  it('no group: MVP summary view, only --limit (1-50)', () => {
    expect(buildTasksParams({})).toEqual({});
    expect(buildTasksParams({ limit: '50' })).toEqual({ limit: 50 });
    expect(() => buildTasksParams({ limit: '51' })).toThrow('--limit');
    expect(() => buildTasksParams({ limit: '0' })).toThrow('--limit');
    expect(() => buildTasksParams({ page: '2' })).toThrow('--group');
    expect(() => buildTasksParams({ pageSize: '10' })).toThrow('--group');
  });

  it('group: paged view with defaults, case-insensitive, --limit refused', () => {
    expect(buildTasksParams({ group: 'Waiting' })).toEqual({ group: 'waiting', pageNum: 1, pageSize: 20 });
    expect(buildTasksParams({ group: 'in_progress', page: '3', pageSize: '100' }))
      .toEqual({ group: 'in_progress', pageNum: 3, pageSize: 100 });
    expect(() => buildTasksParams({ group: 'later' })).toThrow('--group');
    expect(() => buildTasksParams({ group: 'todo', page: '0' })).toThrow('--page');
    expect(() => buildTasksParams({ group: 'todo', pageSize: '101' })).toThrow('--page-size');
    expect(() => buildTasksParams({ group: 'todo', pageSize: '0' })).toThrow('--page-size');
    expect(() => buildTasksParams({ group: 'todo', limit: '5' })).toThrow('--limit');
  });

  it('scope: optional, validated', () => {
    expect(buildProductsParams({})).toEqual({});
    expect(buildProductsParams({ scope: 'Archived' })).toEqual({ scope: 'archived' });
    expect(() => buildProductsParams({ scope: 'mine' })).toThrow('--scope');
  });
});
