import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerAiEmployeeCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerAiEmployeeCommands(program.command('org'));
const emp = (args: string[], response = ok(null)) => runCli(register, ['org', 'ai-employee', ...args], response);

const KEY = { rawKey: 'g7b_sk_abcdef0123456789', keyPrefix: 'g7b_sk_abcd', status: 'active', createdAt: '2026-09-22T10:00:00' };

afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await emp(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('org ai-employee key', () => {
  it('issue POSTs /key and prints the raw key exactly once with the config hint', async () => {
    const r = await emp(['key', 'issue', '58', '7'], ok(KEY));
    expect(r.http.post).toHaveBeenCalledWith('/api/v1/orgs/58/ai-employees/7/key', undefined);
    expect(r.stdout).toContain('已签发 AI 员工 #7 的 Key');
    expect(r.stdout).toContain('只显示这一次');
    expect(r.stdout).toContain('good7ob config set api-key g7b_sk_abcdef0123456789');
    expect(r.stdout.split('g7b_sk_abcdef0123456789').length - 1).toBe(2); // once on its own line + once in the hint
    expect(r.stdout).toContain('前缀 g7b_sk_abcd');
    expect(r.exitCode).toBeUndefined();
  });

  it('regenerate POSTs /key/regenerate', async () => {
    const r = await emp(['key', 'regenerate', '58', '7'], ok(KEY));
    expect(r.http.post).toHaveBeenCalledWith('/api/v1/orgs/58/ai-employees/7/key/regenerate', undefined);
    expect(r.stdout).toContain('已重新生成 AI 员工 #7 的 Key');
  });

  it.each([['disable', 'disabled', '停用'], ['enable', 'active', '启用']])('%s PATCHes /key/status', async (action, status, text) => {
    const r = await emp(['key', action, '58', '7']);
    expect(r.http.patch).toHaveBeenCalledWith('/api/v1/orgs/58/ai-employees/7/key/status', { status });
    expect(r.stdout).toContain(`Key 已${text}`);
    expect(r.http.post).not.toHaveBeenCalled();
  });

  it('prints the raw response with --json', async () => {
    expect(JSON.parse((await emp(['key', 'issue', '58', '7', '--json'], ok(KEY))).stdout)).toEqual(KEY);
  });

  it.each([
    ['unknown action', ['key', 'revoke', '58', '7'], 'action'],
    ['bad org id', ['key', 'issue', 'x', '7'], 'orgId'],
    ['bad employee id', ['key', 'issue', '58', '0'], 'employeeId'],
  ])('rejects %s before calling the API', (_n, args, needle) => expectRejected(args, needle));

  it.each([
    [2000, 'owner/admin'],
    [1002, '不存在'],
    [1007, '状态不允许'],
  ])('maps business error %i', async (code, text) => {
    const r = await emp(['key', 'issue', '58', '7'], bizError(code, 'server says no'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(text);
    expect(r.stderr).toContain('server says no');
  });
});

describe('org ai-employee profile', () => {
  it('PATCHes only the given fields (role upper-cased, lists parsed)', async () => {
    const r = await emp(['profile', '58', '7', '--nickname', ' Cursor ', '--role', 'developer', '--tools', 'task_read, comment,task_read', '--products', '10,11,10']);
    expect(r.http.patch).toHaveBeenCalledWith('/api/v1/orgs/58/ai-employees/7', {
      nickname: 'Cursor', mcpRole: 'DEVELOPER', capabilityScope: { tools: ['task_read', 'comment'], productIds: [10, 11] },
    });
    expect(r.stdout).toContain('✓ AI 员工 #7 档案已更新: nickname, mcpRole, capabilityScope');
  });

  it('sends a bare nickname without capabilityScope; "" clears a list', async () => {
    const a = await emp(['profile', '58', '7', '--nickname', 'X']);
    expect(a.http.patch).toHaveBeenCalledWith('/api/v1/orgs/58/ai-employees/7', { nickname: 'X' });
    const b = await emp(['profile', '58', '7', '--products', '']);
    expect(b.http.patch).toHaveBeenCalledWith('/api/v1/orgs/58/ai-employees/7', { capabilityScope: { productIds: [] } });
  });

  it('prints the raw response with --json', async () => {
    const vo = { id: 7, nickname: 'X', mcpRole: 'VIEWER' };
    expect(JSON.parse((await emp(['profile', '58', '7', '--role', 'VIEWER', '--json'], ok(vo))).stdout)).toEqual(vo);
  });

  it.each([
    ['no options', ['profile', '58', '7'], '至少指定一项'],
    ['unknown role', ['profile', '58', '7', '--role', 'ADMIN'], '--role'],
    ['blank nickname', ['profile', '58', '7', '--nickname', ' '], '--nickname'],
    ['nickname over 50', ['profile', '58', '7', '--nickname', 'a'.repeat(51)], '--nickname'],
    ['bad tool code', ['profile', '58', '7', '--tools', 'task read'], '--tools'],
    ['bad product id', ['profile', '58', '7', '--products', '1,x'], '--products'],
  ])('rejects %s before calling the API', (_n, args, needle) => expectRejected(args, needle));

  it('maps 1001 / 2000', async () => {
    const r = await emp(['profile', '58', '7', '--role', 'MANAGER'], bizError(1001, 'bad'));
    expect(r.stderr).toContain('不合法');
    const p = await emp(['profile', '58', '7', '--role', 'MANAGER'], bizError(2000, 'no'));
    expect(p.stderr).toContain('owner/admin');
  });
});

describe('org ai-employee capabilities', () => {
  const CATALOGUE = [
    { code: 'task_read', label: '读任务', description: '查看任务与动态', managerOnly: false },
    { code: 'prd_write', label: '写 PRD', description: 'x\x1b[2Jy', managerOnly: true },
  ];

  it('GETs the catalogue and renders a table', async () => {
    const r = await emp(['capabilities', '58'], ok(CATALOGUE));
    expect(r.http.get).toHaveBeenCalledWith('/api/v1/orgs/58/ai-employees/capabilities', { params: undefined });
    expect(r.stdout).toContain('task_read');
    expect(r.stdout).toContain('读任务');
    expect(r.stdout).toContain('是');
    expect(r.stdout).toContain('xy');
    expect(r.stdout).not.toContain('\x1b');
  });

  it('prints the raw list with --json and handles an empty catalogue', async () => {
    expect(JSON.parse((await emp(['capabilities', '58', '--json'], ok(CATALOGUE))).stdout)).toEqual(CATALOGUE);
    expect((await emp(['capabilities', '58'], ok([]))).stdout).toContain('没有能力目录');
  });

  it('rejects a bad org id', () => expectRejected(['capabilities', 'x'], 'orgId'));
});
