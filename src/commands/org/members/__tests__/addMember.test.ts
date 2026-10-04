import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerMemberCommands } from '../index';
import { bizError, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerMemberCommands(program.command('org'));
const run = (response = ok({ invited: true, status: 'pending', email: 'a@b.com', role: 'member' })) =>
  runCli(register, ['org', 'add-member', '1', '--email', 'a@b.com'], response);

afterEach(() => vi.restoreAllMocks());

// fix: #75 https://github.com/good7ob/prd/issues/75
describe('org add-member', () => {
  it('POSTs /members/add and reports an invitation was sent, not that the user joined', async () => {
    const r = await run();
    expect(r.http.post).toHaveBeenCalledWith('/api/v1/orgs/1/members/add', { email: 'a@b.com', role: 'member' });
    expect(r.stdout).toContain('已发出邀请，对方接受后加入');
    expect(r.stdout).not.toContain('已直接加入');
    expect(r.exitCode).toBeUndefined();
  });

  it('exits 1 with the business error', async () => {
    const r = await run(bizError(500, 'User is already an active member'));
    expect(r.stderr).toContain('发出邀请失败');
    expect(r.exitCode).toBe(1);
  });
});
