import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerActivityCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerActivityCommands(program.command('pm'));
const activity = (args: string[], response = ok(PAGE)) => runCli(register, ['pm', 'activity', ...args], response);

const ITEM = {
  id: 101, projectId: 1, taskId: 7, taskName: '支付 API', type: 'STATUS_CHANGED', actorType: 'AGENT', actorId: 'emp:3',
  actorName: 'Cursor Agent', actorAvatarUrl: null, channel: 'MCP', fromStatus: 'in_progress', toStatus: 'completed',
  summary: '任务完成', metadata: null, createdAt: '2026-09-22T10:00:00',
};
const PAGE = { items: [ITEM, { ...ITEM, id: 102, type: 'NOTE', actorType: 'USER', actorId: 42, actorName: null, summary: 'x\x1b[2Jy' }], nextSinceId: 102, hasMore: true };

afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await activity(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('pm activity (list)', () => {
  it('GETs project activities in page mode with defaults', async () => {
    const r = await activity(['--project', '1']);
    expect(r.http.get).toHaveBeenCalledWith('/progress/projects/1/activities', { params: { pageNum: 1, pageSize: 20 } });
    expect(r.exitCode).toBeUndefined();
  });

  it('GETs task activities with explicit paging', async () => {
    const r = await activity(['--task', '7', '-p', '2', '--page-size', '50']);
    expect(r.http.get).toHaveBeenCalledWith('/progress/tasks/7/activities', { params: { pageNum: 2, pageSize: 50 } });
  });

  it('--since switches to cursor mode and passes filters (types upper-cased, de-duplicated)', async () => {
    const r = await activity(['--project', '1', '--since', '100', '--limit', '10', '--type', 'handoff,NOTE,handoff', '--actor', 'agent']);
    expect(r.http.get).toHaveBeenCalledWith('/progress/projects/1/activities', {
      params: { sinceId: 100, limit: 10, types: 'HANDOFF,NOTE', actorType: 'AGENT' },
    });
  });

  it('renders a table with the cursor footer and strips control characters', async () => {
    const out = (await activity(['--project', '1'])).stdout;
    expect(out).toContain('101');
    expect(out).toContain('Cursor Agent');
    expect(out).toContain('USER:42');
    expect(out).toContain('#7 支付 API');
    expect(out).toContain('2026-09-22 10:00:00');
    expect(out).toContain('nextSinceId=102 hasMore=true');
    expect(out).toContain('xy');
    expect(out).not.toContain('\x1b');
  });

  it('shows an empty message plus footer', async () => {
    const out = (await activity(['--task', '7'], ok({ items: [], nextSinceId: null, hasMore: false }))).stdout;
    expect(out).toContain('没有符合条件的动态');
    expect(out).toContain('nextSinceId=— hasMore=false');
  });

  it('prints the raw page with --json', async () => {
    expect(JSON.parse((await activity(['--project', '1', '--json'])).stdout)).toEqual(PAGE);
  });

  it.each([
    ['neither --project nor --task', [], '必须且只能指定一个'],
    ['both --project and --task', ['--project', '1', '--task', '7'], '必须且只能指定一个'],
    ['non-numeric project', ['--project', 'x'], '--project'],
    ['--since with --page', ['--project', '1', '--since', '5', '--page', '2'], '--since'],
    ['--limit without --since', ['--project', '1', '--limit', '5'], '--limit'],
    ['limit out of range', ['--project', '1', '--since', '5', '--limit', '201'], '--limit'],
    ['unknown actor', ['--project', '1', '--actor', 'BOT'], '--actor'],
    ['bad type code', ['--project', '1', '--type', 'a-b'], '--type'],
    ['filters on a task', ['--task', '7', '--type', 'NOTE'], '只支持 --project'],
  ])('rejects %s before calling the API', (_n, args, needle) => expectRejected(args, needle));

  it.each([
    [1002, '不存在'],
    [2000, '无权限'],
    [1001, '不合法'],
  ])('maps business error %i', async (code, text) => {
    const r = await activity(['--project', '1'], bizError(code, 'server says no'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain('server says no');
  });
});

describe('pm activity post', () => {
  it('POSTs a NOTE by default', async () => {
    const r = await activity(['post', '--task', '7', '--summary', '已联调完成'], ok({ ...ITEM, id: 103, type: 'NOTE' }));
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/7/activities', { type: 'NOTE', summary: '已联调完成' });
    expect(r.stdout).toContain('✓ 动态已写入: #103 NOTE 任务 #7');
    expect(r.exitCode).toBeUndefined();
  });

  it('POSTs REPORT_UPLOADED with metadata.url', async () => {
    const r = await activity(['post', '--task', '7', '--summary', '报告', '--type', 'report_uploaded', '--url', 'https://x.test/r.pdf']);
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/7/activities', {
      type: 'REPORT_UPLOADED', summary: '报告', metadata: { url: 'https://x.test/r.pdf' },
    });
  });

  it('prints the raw activity with --json', async () => {
    const r = await activity(['post', '--task', '7', '--summary', 's', '--json'], ok(ITEM));
    expect(JSON.parse(r.stdout)).toEqual(ITEM);
  });

  it.each([
    ['missing --task', ['post', '--summary', 's'], '--task'],
    ['missing --summary', ['post', '--task', '7'], '--summary'],
    ['blank summary', ['post', '--task', '7', '--summary', '  '], '--summary'],
    ['summary over 500 chars', ['post', '--task', '7', '--summary', 'a'.repeat(501)], '500'],
    ['unknown type', ['post', '--task', '7', '--summary', 's', '--type', 'HANDOFF'], '--type'],
    ['http url', ['post', '--task', '7', '--summary', 's', '--url', 'http://x.test'], 'https://'],
  ])('rejects %s before calling the API', (_n, args, needle) => expectRejected(args, needle));

  it('maps 2000 (employee without comment capability)', async () => {
    const r = await activity(['post', '--task', '7', '--summary', 's'], bizError(2000, 'no'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('无权限');
  });
});
