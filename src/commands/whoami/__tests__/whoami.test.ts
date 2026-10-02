import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWhoamiCommands } from '../index';
import { bizError, ok, runCli } from '../../../utils/__tests__/cliHarness';

const whoami = (args: string[] = [], response = ok(EMPLOYEE)) => runCli(registerWhoamiCommands, ['whoami', ...args], response);

const EMPLOYEE = {
  actorType: 'AGENT', userId: 42, channel: 'CLI',
  employee: { id: 7, orgId: 58, nickname: 'Cursor\x1b[2J Agent', mcpRole: 'DEVELOPER', capabilityScope: { tools: ['task_read', 'comment'], productIds: [10, 11] } },
};

afterEach(() => vi.restoreAllMocks());

describe('whoami', () => {
  it('GETs /api/v1/me/actor and shows the employee block (control characters stripped)', async () => {
    const r = await whoami();
    expect(r.http.get).toHaveBeenCalledWith('/api/v1/me/actor', { params: undefined });
    expect(r.stdout).toContain('身份:     AGENT（AI 员工）');
    expect(r.stdout).toContain('用户 ID:  42');
    expect(r.stdout).toContain('渠道:     CLI');
    expect(r.stdout).toContain('昵称:   Cursor Agent');
    expect(r.stdout).toContain('组织:   58');
    expect(r.stdout).toContain('角色:   DEVELOPER');
    expect(r.stdout).toContain('能力:   task_read, comment');
    expect(r.stdout).toContain('产品:   10, 11');
    expect(r.stdout).not.toContain('\x1b');
    expect(r.exitCode).toBeUndefined();
  });

  it('shows a plain user without the employee block; empty productIds means unrestricted', async () => {
    const r = await whoami([], ok({ actorType: 'USER', userId: 42, channel: 'CLI' }));
    expect(r.stdout).toContain('身份:     USER（人类用户）');
    expect(r.stdout).not.toContain('AI 员工:');
    const e = await whoami([], ok({ ...EMPLOYEE, employee: { ...EMPLOYEE.employee, capabilityScope: { tools: [], productIds: [] } } }));
    expect(e.stdout).toContain('能力:   （无）');
    expect(e.stdout).toContain('产品:   不限');
  });

  it('prints the raw actor with --json', async () => {
    expect(JSON.parse((await whoami(['--json'])).stdout)).toEqual(EMPLOYEE);
  });

  it('maps an auth failure', async () => {
    const r = await whoami([], bizError(401, 'expired'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('未登录或凭证已失效');
  });
});
