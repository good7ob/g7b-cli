import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Envelope, bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { registerHabitCommands } from '../index';

afterEach(() => vi.restoreAllMocks());

const B = '/api/v1/me/work-habits';
const habit = (over: Record<string, unknown> = {}) => ({
  id: 101, title: '一主题一分支一 PR', content: '每个主题单独建分支。', category: 'PROCESS', level: 'STABLE', source: 'MANUAL',
  status: 'ENABLED', sortOrder: 1, version: 3, createdAt: 1760745600000, updatedAt: 1760832000000, ...over,
});
const grouped = (...items: any[]) => ({ total: items.length, groups: [{ category: 'PROCESS', items }] });
const cli = (args: string[], res: any = ok(null)) => runCli(registerHabitCommands, ['habit', ...args], res);
const lastCall = (fn: any) => fn.mock.calls[fn.mock.calls.length - 1];

async function rejects(args: string[], needle: string) {
  const r = await cli(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('habit list', () => {
  it('GETs the list with normalised filters and renders a table', async () => {
    const r = await cli(['list', '--category', 'process', '--level', 'stable', '--keyword', ' 分支 ', '--status', 'disabled'], ok(grouped(habit())));
    expect(r.http.get).toHaveBeenCalledWith(B, { params: { keyword: '分支', category: 'PROCESS', level: 'STABLE', status: 'DISABLED' } });
    expect(r.stdout).toContain('一主题一分支一 PR');
    expect(r.stdout).toContain('稳定偏好');
    expect(r.stdout).toContain('共 1 条');
  });
  it('--json prints the raw data', async () => {
    const data = grouped(habit());
    expect(JSON.parse((await cli(['list', '--json'], ok(data))).stdout)).toEqual(data);
  });
  it('says so when empty', async () => {
    expect((await cli(['list'], ok({ total: 0, groups: [] }))).stdout).toContain('没有习惯条目');
  });
  it.each([['--category', 'x'], ['--level', 'x'], ['--source', 'x'], ['--status', 'x']])('rejects bad %s', (f, v) => rejects(['list', f, v], f));
});

describe('habit list --status', () => {
  it('PENDING is not a list status (use candidates)', () => rejects(['list', '--status', 'PENDING'], '--status'));
});

describe('habit add', () => {
  const ok1 = { title: '汇报用中文', content: '一律用中文。', category: 'communication' };
  const flags = ['add', '--title', ok1.title, '--content', ok1.content, '--category', ok1.category];
  it('POSTs the trimmed body (level omitted)', async () => {
    const r = await cli(flags, ok(habit({ id: 7, title: ok1.title, category: 'COMMUNICATION' })));
    expect(r.http.post).toHaveBeenCalledWith(B, { title: '汇报用中文', content: '一律用中文。', category: 'COMMUNICATION' });
    expect(r.stdout).toContain('已新增习惯 #7');
  });
  it('sends level when given', async () => {
    const r = await cli([...flags, '--level', 'local'], ok(habit()));
    expect(lastCall(r.http.post)[1].level).toBe('LOCAL');
  });
  it.each([
    [['--title', ' '], '--title'],
    [['--title', 'x'.repeat(51)], '最多 50'],
    [['--content', ''], '--content'],
    [['--content', '字'.repeat(501)], '最多 500'],
    [['--category', 'misc'], '--category'],
    [['--level', 'high'], '--level'],
  ])('rejects %j before any request', (over, needle) => {
    const base: Record<string, string> = { '--title': 't', '--content': 'c', '--category': 'CODE' };
    for (let i = 0; i < over.length; i += 2) base[over[i]] = over[i + 1];
    return rejects(['add', ...Object.entries(base).flat()], needle);
  });
  it('counts characters, not UTF-16 units (50 emoji is fine)', async () => {
    const r = await cli(['add', '--title', '😀'.repeat(50), '--content', 'c', '--category', 'CODE'], ok(habit()));
    expect(r.exitCode).toBeUndefined();
  });
  it('requires --category', async () => {
    const r = await cli(['add', '--title', 't', '--content', 'c']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });
});

describe('habit edit', () => {
  const route = (m: string, url: string): Envelope => (m === 'get' ? ok(grouped(habit())) : ok(habit({ version: 4 })));
  it('reads the current version, merges unset fields, PUTs', async () => {
    const r = await cli(['edit', '101', '--content', '新内容'], route);
    expect(r.http.put).toHaveBeenCalledWith(`${B}/101`, {
      title: '一主题一分支一 PR', content: '新内容', category: 'PROCESS', level: 'STABLE', version: 3,
    });
    expect(r.stdout).toContain('已修改习惯 #101');
  });
  it('--version overrides the fetched version', async () => {
    const r = await cli(['edit', '101', '--title', 'T', '--version', '2'], route);
    expect(lastCall(r.http.put)[1].version).toBe(2);
  });
  it('needs at least one field; bad id and bad version rejected', async () => {
    await rejects(['edit', '101'], '至少给出');
    await rejects(['edit', 'abc', '--title', 't'], 'id');
    await rejects(['edit', '101', '--title', 't', '--version', '0'], '--version');
  });
  it('unknown id: explains where candidates go', async () => {
    const r = await cli(['edit', '999', '--title', 't'], ok(grouped(habit())));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('未找到习惯 #999');
    expect(r.http.put).not.toHaveBeenCalled();
  });
  it('1009 gets the refresh hint', async () => {
    const r = await cli(['edit', '101', '--title', 't'], (m) => (m === 'get' ? ok(grouped(habit())) : bizError(1009, '内容已被其他窗口修改，请刷新后重试')));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('请刷新');
    expect(r.stderr).toContain('1009');
  });
});

describe('habit enable / disable / remove', () => {
  const route = (m: string): Envelope => (m === 'get' ? ok(grouped(habit())) : ok(habit({ status: 'DISABLED', version: 4 })));
  it('POSTs status with the fetched version', async () => {
    const r = await cli(['disable', '101'], route);
    expect(r.http.post).toHaveBeenCalledWith(`${B}/101/status`, { status: 'DISABLED', version: 3 });
    expect((await cli(['enable', '101'], route)).http.post).toHaveBeenCalledWith(`${B}/101/status`, { status: 'ENABLED', version: 3 });
  });
  it('remove without --yes in a non-interactive shell refuses and does not call DELETE', async () => {
    const r = await cli(['remove', '101']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--yes');
    expect(r.http.delete).not.toHaveBeenCalled();
  });
  it('remove --yes DELETEs; --json prints a result', async () => {
    const r = await cli(['remove', '101', '--yes', '--json']);
    expect(r.http.delete).toHaveBeenCalledWith(`${B}/101`, undefined);
    expect(JSON.parse(r.stdout)).toEqual({ id: 101, removed: true });
  });
  it('1002 / 2000 map to readable Chinese', async () => {
    expect((await cli(['remove', '1', '--yes'], bizError(1002, '习惯不存在'))).stderr).toContain('不存在或不属于你');
    expect((await cli(['remove', '1', '--yes'], bizError(2000, '暂无权限'))).stderr).toContain('AI 员工');
  });
});

describe('habit export', () => {
  const data = { markdown: '# 我的工作习惯\n\n## 流程\n', habitCount: 2, workflowCount: 1, filename: 'work-habits-20261018.md' };
  it('prints raw markdown to stdout, defaults scope=enabled, no workflows', async () => {
    const r = await cli(['export'], ok(data));
    expect(r.http.get).toHaveBeenCalledWith(`${B}/export`, { params: { scope: 'enabled' } });
    expect(r.stdout).toBe('# 我的工作习惯\n\n## 流程');
  });
  it('--include-workflows and filtered scope pass filters', async () => {
    const r = await cli(['export', '--include-workflows', '--scope', 'filtered', '--category', 'code', '--keyword', 'x'], ok(data));
    expect(r.http.get).toHaveBeenCalledWith(`${B}/export`, { params: { scope: 'filtered', includeWorkflows: 'true', category: 'CODE', keyword: 'x' } });
  });
  it('enabled scope ignores filters', async () => {
    const r = await cli(['export', '--category', 'code'], ok(data));
    expect(r.http.get).toHaveBeenCalledWith(`${B}/export`, { params: { scope: 'enabled' } });
  });
  it('--out writes the file and prints a summary', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'habit-')), 'h.md');
    const r = await cli(['export', '--out', out], ok(data));
    expect(readFileSync(out, 'utf8')).toBe(data.markdown);
    expect(r.stdout).toContain('已写入');
    expect(r.stdout).not.toContain('# 我的工作习惯');
  });
  it('--json prints the envelope data; empty export (1002) is reported', async () => {
    expect(JSON.parse((await cli(['export', '--json'], ok(data))).stdout)).toEqual(data);
    const r = await cli(['export'], bizError(1002, '没有可导出的习惯'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('没有可导出的习惯');
  });
  it('--workflows and --file are aliases of --include-workflows and --out', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'habit-')), 'a.md');
    const r = await cli(['export', '--workflows', '--file', out], ok(data));
    expect(r.http.get).toHaveBeenCalledWith(`${B}/export`, { params: { scope: 'enabled', includeWorkflows: 'true' } });
    expect(readFileSync(out, 'utf8')).toBe(data.markdown);
  });
  it('rejects a bad scope', () => rejects(['export', '--scope', 'all'], '--scope'));
});

describe('habit candidates / confirm / reject', () => {
  const cand = habit({ id: 301, status: 'PENDING', source: 'AI_EXTRACTED', confidence: 'HIGH', version: 1, level: 'LOCAL',
    evidence: [{ sourceType: 'COMMIT', summary: '分支只含一项改动' }] });
  const route = (m: string): Envelope => (m === 'get' ? ok(grouped(cand)) : ok(habit({ id: 301, version: 2 })));
  it('lists PENDING with confidence and evidence', async () => {
    const r = await cli(['candidates', '--category', 'process'], ok(grouped(cand)));
    expect(r.http.get).toHaveBeenCalledWith(B, { params: { category: 'PROCESS', status: 'PENDING' } });
    expect(r.stdout).toContain('高');
    expect(r.stdout).toContain('分支只含一项改动');
  });
  it('confirm as-is sends only the version', async () => {
    const r = await cli(['confirm', '301'], route);
    expect(r.http.get).toHaveBeenCalledWith(B, { params: { status: 'PENDING' } });
    expect(r.http.post).toHaveBeenCalledWith(`${B}/301/confirm`, { version: 1 });
  });
  it('confirm with edits sends the full four fields merged with the candidate', async () => {
    const r = await cli(['confirm', '301', '--title', '新标题', '--level', 'stable'], route);
    expect(lastCall(r.http.post)[1]).toEqual({ version: 1, title: '新标题', content: cand.content, category: 'PROCESS', level: 'STABLE' });
  });
  it('confirm validates edits before calling', () => rejects(['confirm', '301', '--title', 'x'.repeat(51)], '最多 50'));
  it('reject POSTs the version', async () => {
    const r = await cli(['reject', '301', '--json'], route);
    expect(r.http.post).toHaveBeenCalledWith(`${B}/301/reject`, { version: 1 });
    expect(JSON.parse(r.stdout)).toEqual({ id: 301, rejected: true });
  });
  it('a non-candidate id is reported', async () => {
    const r = await cli(['reject', '5'], ok(grouped()));
    expect(r.stderr).toContain('不是待确认候选');
  });
  it('1007 maps to a status hint', async () => {
    const r = await cli(['confirm', '301'], (m) => (m === 'get' ? ok(grouped(cand)) : bizError(1007, '该条目不是待确认状态')));
    expect(r.stderr).toContain('当前状态不支持');
  });
});
