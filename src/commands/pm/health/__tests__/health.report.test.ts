import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import apiClient from '../../../../services/ApiClient';
import { registerHealthCommands } from '../index';
import { buildReportBody, resolveOutPath } from '../intelInput';
import { bizError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerHealthCommands(program.command('pm'));
const report = (args: string[], response = ok(null)) => runCli(register, ['pm', 'health', 'report', ...args], response);

// 2026-09-19 is a Saturday
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-19T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function expectRejected(args: string[], needle: string) {
  const r = await report(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const full = {
  id: 7, productId: 12, releaseId: null, periodType: 'week', periodFrom: '2026-09-07', periodTo: '2026-09-13', weightBasis: 'ESTIMATED_HOURS',
  title: 'good7ob 周报 2026-09-07 ~ 2026-09-13', contentMarkdown: '# 周报\n\n## 进度\n数据不足', structured: { period: {}, aiSummary: null },
  aiPolished: false, aiModel: null, aiWarning: null, createdBy: 11, createdAt: '2026-09-19T10:00:00',
};

describe('pm health report generate <productId>', () => {
  it('POSTs a week report with no dates (server picks the last complete week) and no client timeout override', async () => {
    const r = await report(['generate', '12', '--period', 'week'], ok(full));
    expect(r.http.post).toHaveBeenCalledWith('/progress/products/12/reports/management', { periodType: 'week' });
    expect(r.exitCode).toBeUndefined();
  });

  it('week / month with --from, --release; --ai adds useAi and the long timeout', async () => {
    const r = await report(['generate', '12', '--period', 'MONTH', '--from', '2026-08-15', '--release', '5', '--ai'], ok({ ...full, aiPolished: true, aiModel: 'claude-x' }));
    expect(r.http.post).toHaveBeenCalledWith('/progress/products/12/reports/management',
      { periodType: 'month', from: '2026-08-15', releaseId: 5, useAi: true }, { timeout: 180000 });
  });

  it('custom needs --from and --to', async () => {
    const r = await report(['generate', '12', '--period', 'custom', '--from', '2026-09-01', '--to', '2026-09-19'], ok(full));
    expect(r.http.post).toHaveBeenCalledWith('/progress/products/12/reports/management', { periodType: 'custom', from: '2026-09-01', to: '2026-09-19' });
  });

  it.each([
    [['--period', 'quarter'], '--period'],
    [['--period', 'custom', '--from', '2026-09-01'], '同时给出'],
    [['--period', 'custom', '--to', '2026-09-01'], '同时给出'],
    [['--period', 'custom', '--from', '2026-09-10', '--to', '2026-09-01'], '不能晚于'],
    [['--period', 'custom', '--from', '2026-09-01', '--to', '2026-09-20'], '今天'],
    [['--period', 'custom', '--from', '1999-12-31', '--to', '2000-01-05'], '2000-01-01'],
    [['--period', 'custom', '--from', '2026-06-19', '--to', '2026-09-19'], '92 天'],
    [['--period', 'custom', '--from', '2026-02-30', '--to', '2026-03-05'], '--from'],
    [['--period', 'week', '--to', '2026-09-13'], '--to 只用于'],
    [['--period', 'month', '--to', '2026-09-13'], '--to 只用于'],
    [['--period', 'week', '--from', '2026-09-21'], '未来'],
    [['--period', 'month', '--from', '2026-10-01'], '未来'],
    [['--period', 'week', '--from', '2000-01-01'], '2000-01-01'],
    [['--period', 'week', '--from', 'tomorrow'], '--from'],
    [['--period', 'week', '--release', '0'], '--release'],
  ])('rejects %j locally', (flags, needle) => expectRejected(['generate', '12', ...flags], needle));

  it('custom boundaries: exactly 92 days inclusive, to = today, and 1 day', async () => {
    expect(buildReportBody({ period: 'custom', from: '2026-06-20', to: '2026-09-19' })).toMatchObject({ from: '2026-06-20' });
    expect(() => buildReportBody({ period: 'custom', from: '2026-06-19', to: '2026-09-19' })).toThrow('当前 93 天');
    expect(buildReportBody({ period: 'custom', from: '2026-09-19', to: '2026-09-19' })).toMatchObject({ to: '2026-09-19' });
  });

  it('week / month anchors: a day in the current (unfinished) week / month is fine, next week is not', () => {
    expect(buildReportBody({ period: 'week', from: '2026-09-19' })).toMatchObject({ from: '2026-09-19' });
    expect(buildReportBody({ period: 'month', from: '2026-09-30' })).toMatchObject({ from: '2026-09-30' });
    expect(() => buildReportBody({ period: 'week', from: '2026-09-21' })).toThrow('未来');
    // clock injected: on a Monday a day later in that week is still this week
    expect(buildReportBody({ period: 'week', from: '2026-09-27' }, new Date('2026-09-21T00:00:00Z'))).toMatchObject({ from: '2026-09-27' });
  });

  it('requires --period', async () => {
    const r = await report(['generate', '12']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('prints the meta block and the Markdown body; a null / missing body is stated, not blank', async () => {
    const out = (await report(['generate', '12', '--period', 'week'], ok(full))).stdout;
    expect(out).toContain('✓ 管理报告已生成');
    expect(out).toMatch(/报告\s+#7  good7ob 周报/);
    expect(out).toMatch(/类型 \/ 期间\s+week  2026-09-07 ~ 2026-09-13/);
    expect(out).toContain('# 周报');
    expect(out).toContain('数据不足');
    expect(out).not.toContain('AI 生成');
    expect((await report(['generate', '12', '--period', 'week'], ok({ ...full, contentMarkdown: null }))).stdout).toContain('（报告没有正文）');
  });

  it('marks an AI summary as AI-generated; an AI failure is a warning on a complete report', async () => {
    const withAi = (await report(['generate', '12', '--period', 'week', '--ai'], ok({ ...full, aiPolished: true, aiModel: 'claude-x' }))).stdout;
    expect(withAi).toContain('含 AI 生成的摘要章节（模型 claude-x；AI 生成，需人工确认');
    const failed = await report(['generate', '12', '--period', 'week', '--ai'], ok({ ...full, aiWarning: 'token 余额不足' }));
    expect(failed.exitCode).toBeUndefined();
    expect(failed.stdout).toContain('⚠ AI 摘要未生成：token 余额不足');
    expect(failed.stdout).not.toContain('含 AI 生成');
  });

  it('prints --json (with the structured sections)', async () => {
    const r = await report(['generate', '12', '--period', 'week', '--json'], ok(full));
    expect(JSON.parse(r.stdout).structured).toEqual({ period: {}, aiSummary: null });
  });

  it.each([[1000, '缺少必填'], [1001, '报告期不合法'], [1002, '不存在'], [2000, '组织的成员']])('maps business error %i', async (code, text) => {
    const r = await report(['generate', '12', '--period', 'week'], bizError(code, 'srv'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('生成管理报告失败');
    expect(r.stderr).toContain(text);
  });

  it('a client timeout points at `report list` instead of inviting a blind retry', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('timeout of 180000ms exceeded'));
    const r = await report(['generate', '12', '--period', 'week', '--ai']);
    expect(r.stderr).toContain('report list');
    expect(r.stderr).toContain('不要盲目重试');
  });
});

describe('pm health report list <productId>', () => {
  const page = { records: [{ id: 7, periodType: 'week', periodFrom: '2026-09-07', periodTo: '2026-09-13', title: '周报', aiPolished: true, releaseId: 5, createdAt: '2026-09-19T10:00:00' }, { id: 6, periodType: 'custom', periodFrom: null, periodTo: null, title: null, aiPolished: false, createdAt: null }], total: 9, current: 1, size: 20, pages: 1 };

  it('GETs with default paging, then with every filter', async () => {
    expect((await report(['list', '12'], ok(page))).http.get).toHaveBeenCalledWith('/progress/products/12/reports/management', { params: { pageNum: 1, pageSize: 20 } });
    const r = await report(['list', '12', '--release', '5', '--period', 'CUSTOM', '-p', '3', '--page-size', '100'], ok(page));
    expect(r.http.get).toHaveBeenCalledWith('/progress/products/12/reports/management', { params: { pageNum: 3, pageSize: 100, releaseId: 5, periodType: 'custom' } });
  });

  it('renders the table (null cells —, AI yes/no) and the footer', async () => {
    const out = (await report(['list', '12'], ok(page))).stdout;
    expect(out).toMatch(/7\s+week\s+2026-09-07 ~ 2026-09-13\s+5\s+是\s+2026-09-19 10:00:00\s+周报/);
    expect(out).toMatch(/6\s+custom\s+—\s+—\s+否\s+—\s+—/);
    expect(out).toContain('共 9 条，第 1/1 页');
  });

  it('empty page / null body / --json', async () => {
    expect((await report(['list', '12'], ok({ records: [], total: 0 }))).stdout).toContain('没有管理报告');
    expect((await report(['list', '12'], ok(null))).stdout).toContain('没有管理报告');
    expect(JSON.parse((await report(['list', '12', '--json'], ok(page))).stdout).total).toBe(9);
  });

  it.each([[['--period', 'day'], '--period'], [['--page', '0'], '--page'], [['--page-size', '0'], '--page-size'], [['--page-size', '101'], '--page-size'], [['--release', 'x'], '--release']])(
    'rejects %j locally', (flags, needle) => expectRejected(['list', '12', ...flags], needle));

  it('maps 1002', async () => {
    expect((await report(['list', '12'], bizError(1002))).stderr).toContain('不存在');
  });
});

describe('pm health report get <id>', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-report-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('GETs /progress/reports/management/{id} and prints meta + Markdown', async () => {
    const r = await report(['get', '7'], ok(full));
    expect(r.http.get).toHaveBeenCalledWith('/progress/reports/management/7', { params: undefined });
    expect(r.stdout).toContain('# 周报');
    expect(r.stdout).toMatch(/报告\s+#7/);
  });

  it('--out writes the Markdown body (with a trailing newline) and does not print it', async () => {
    const file = path.join(dir, 'weekly.md');
    const r = await report(['get', '7', '--out', file], ok(full));
    expect(fs.readFileSync(file, 'utf-8')).toBe('# 周报\n\n## 进度\n数据不足\n');
    expect(r.stdout).toContain(`✓ 已写入 ${file}`);
    expect(r.stdout).not.toContain('## 进度');
  });

  it('untrusted title / body text cannot inject terminal escapes; the --out file and --json stay verbatim', async () => {
    const evil = { ...full, title: 'T\x1b[31mred', contentMarkdown: '# x\x1b]0;pwn\x07y\x1b[2J' };
    expect((await report(['get', '7'], ok(evil))).stdout).not.toContain('\x1b');
    expect((await report(['generate', '12', '--period', 'week'], ok(evil))).stdout).not.toContain('\x1b');
    expect(JSON.parse((await report(['get', '7', '--json'], ok(evil))).stdout).title).toBe('T\x1b[31mred');
    const file = path.join(dir, 'evil.md');
    await report(['get', '7', '--out', file], ok(evil));
    expect(fs.readFileSync(file, 'utf-8')).toContain('\x1b]0;pwn');
  });

  it('--out overwrites an existing file (no prompt)', async () => {
    const file = path.join(dir, 'weekly.md');
    fs.writeFileSync(file, 'old');
    await report(['get', '7', '--out', file], ok(full));
    expect(fs.readFileSync(file, 'utf-8')).toContain('# 周报');
  });

  it('--out with --json writes the file and keeps stdout pure JSON', async () => {
    const file = path.join(dir, 'w.md');
    const r = await report(['get', '7', '--out', file, '--json'], ok(full));
    expect(JSON.parse(r.stdout).id).toBe(7);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('--out with a missing directory / a directory / blank is refused before any request', async () => {
    await expectRejected(['get', '7', '--out', path.join(dir, 'nope', 'x.md')], '目录不存在');
    await expectRejected(['get', '7', '--out', dir], '是一个目录');
    await expectRejected(['get', '7', '--out', '  '], '--out');
  });

  it('--out with a report that has no body fails and writes nothing', async () => {
    const file = path.join(dir, 'empty.md');
    const r = await report(['get', '7', '--out', file], ok({ ...full, contentMarkdown: null }));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('没有正文');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('a relative --out resolves against the current directory', () => {
    expect(resolveOutPath('rel.md')).toBe(path.resolve('rel.md'));
    expect(resolveOutPath(undefined)).toBeUndefined();
  });

  it('shows the AI notes and the sections with --json; rejects bad ids; maps 1002 / 2000', async () => {
    const out = (await report(['get', '7'], ok({ ...full, aiPolished: true, aiModel: 'm', aiWarning: null }))).stdout;
    expect(out).toContain('含 AI 生成的摘要章节');
    await expectRejected(['get', 'abc'], 'id');
    expect((await report(['get', '7'], bizError(1002))).stderr).toContain('不存在');
    expect((await report(['get', '7'], bizError(2000))).stderr).toContain('组织的成员');
    expect((await report(['get', '7'], ok(null))).exitCode).toBeUndefined();
  });
});
