import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { ACCEPTANCE_SUBMITTED, registerTaskCommands, skipAcceptanceFields, wentToAcceptance } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

// idea #210: AI-implemented tasks of product-linked projects go to 完成待验收 (awaiting_completion_approval)

const register = (program: Command) => registerTaskCommands(program.command('pm'));
const run = (args: string[], response = ok(null)) => runCli(register, ['pm', 'task', ...args], response);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pm task update --status completed', () => {
  it('prints the 已提交验收 line when the server routed the completion to acceptance', async () => {
    const r = await run(['update', '7', '--status', 'completed'],
      ok({ id: 7, status: 'awaiting_completion_approval', acceptanceRequired: true }));
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/7', { status: 'completed' });
    expect(r.stdout).toContain(ACCEPTANCE_SUBMITTED);
    expect(r.stdout).not.toContain('任务已更新');
    expect(r.exitCode).toBeUndefined();
  });

  it('also recognises a different stored status without the flag (older field set)', async () => {
    const r = await run(['update', '7', '--status', 'completed'], ok({ id: 7, status: 'awaiting_completion_approval' }));
    expect(r.stdout).toContain(ACCEPTANCE_SUBMITTED);
  });

  it('keeps the plain success line when the task really completed', async () => {
    const r = await run(['update', '7', '--status', 'completed'],
      ok({ id: 7, status: 'completed', acceptanceRequired: false }));
    expect(r.stdout).toContain('✓ 任务已更新: 7');
    expect(r.stdout).not.toContain(ACCEPTANCE_SUBMITTED);
  });

  it('--json prints the returned task', async () => {
    const r = await run(['update', '7', '--status', 'completed', '--json'],
      ok({ id: 7, status: 'awaiting_completion_approval', acceptanceRequired: true }));
    expect(JSON.parse(r.stdout)).toMatchObject({ status: 'awaiting_completion_approval', acceptanceRequired: true });
  });
});

describe('pm task update --skip-acceptance', () => {
  it('sends skipAcceptance with the trimmed reason', async () => {
    const r = await run(['update', '7', '--status', 'completed', '--skip-acceptance', '--reason', ' 已人工验证 '],
      ok({ id: 7, status: 'completed', acceptanceRequired: false }));
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/7', {
      status: 'completed', skipAcceptance: true, skipAcceptanceReason: '已人工验证',
    });
    expect(r.stdout).toContain('✓ 任务已更新: 7');
  });

  it.each([
    [['--skip-acceptance', '--status', 'completed'], '--reason'],
    [['--skip-acceptance', '--status', 'completed', '--reason', '   '], '--reason'],
    [['--skip-acceptance', '--reason', 'x'], '--status completed'],
    [['--status', 'completed', '--reason', 'x'], '--skip-acceptance'],
    [['--skip-acceptance', '--status', 'completed', '--reason', 'x'.repeat(501)], '500'],
  ])('rejects %j before any request', async (args, message) => {
    const r = await run(['update', '7', ...(args as string[])]);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
    expect(r.stderr).toContain(message as string);
  });

  it('shows the server refusal of an AI employee skip (2000)', async () => {
    const r = await run(['update', '7', '--status', 'completed', '--skip-acceptance', '--reason', '已人工验证'],
      bizError(2000, 'AI 员工不能跳过验收'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('AI 员工不能跳过验收');
  });

  it('lists awaiting_completion_approval in the --status help', async () => {
    const r = await run(['update', '--help']);
    expect(r.stdout).toContain('awaiting_completion_approval');
    expect(r.stdout).toContain('--skip-acceptance');
  });
});

describe('pm task submit-acceptance', () => {
  it('posts the summary and prints the 已提交验收 line', async () => {
    const r = await run(['submit-acceptance', '7', '--summary', ' 登录页已实现 '],
      ok({ id: 7, status: 'awaiting_completion_approval', acceptanceRequired: true }));
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/7/submit-acceptance', { summary: '登录页已实现' });
    expect(r.stdout).toContain(`✓ ${ACCEPTANCE_SUBMITTED}: 7`);
    expect(r.exitCode).toBeUndefined();
  });

  it('posts an empty body without --summary', async () => {
    const r = await run(['submit-acceptance', '7'], ok({ id: 7, status: 'awaiting_completion_approval' }));
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/7/submit-acceptance', {});
  });

  it('fails with the server message when the task is not in progress (1007)', async () => {
    const r = await run(['submit-acceptance', '7'], bizError(1007, '仅进行中的任务可提交验收'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('仅进行中的任务可提交验收');
  });

  it('rejects a bad id and an over-long summary locally', async () => {
    expect((await run(['submit-acceptance', 'abc'])).exitCode).toBe(1);
    const r = await run(['submit-acceptance', '7', '--summary', 'x'.repeat(501)]);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });
});

describe('pm task batch-update', () => {
  it('sends taskIds (the field the backend reads) and reports the tasks routed to acceptance', async () => {
    const r = await run(['batch-update', '--ids', '7, 8', '--status', 'completed'], ok({
      successCount: 2, failedCount: 0, acceptanceRequired: true, acceptanceRequiredTaskIds: [7],
    }));
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/batch', { taskIds: [7, 8], status: 'completed' });
    expect(r.stdout).toContain('✓ 已批量更新 2 个任务');
    expect(r.stdout).toContain(`${ACCEPTANCE_SUBMITTED}: 7`);
  });

  it('passes --skip-acceptance --reason', async () => {
    const r = await run(['batch-update', '--ids', '7', '--status', 'completed', '--skip-acceptance', '--reason', '已人工验证'],
      ok({ successCount: 1, failedCount: 0, acceptanceRequired: false, acceptanceRequiredTaskIds: [] }));
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/batch', {
      taskIds: [7], status: 'completed', skipAcceptance: true, skipAcceptanceReason: '已人工验证',
    });
    expect(r.stdout).not.toContain(ACCEPTANCE_SUBMITTED);
  });

  it('still understands an older server answering a bare count', async () => {
    const r = await run(['batch-update', '--ids', '7,8', '--priority', 'high'], ok(1));
    expect(r.stdout).toContain('✓ 已批量更新 1 个任务');
  });
});

describe('helpers', () => {
  it('skipAcceptanceFields is empty without the flag', () => {
    expect(skipAcceptanceFields({ status: 'completed' })).toEqual({});
  });

  it('wentToAcceptance reads the flag or the stored status', () => {
    expect(wentToAcceptance({ acceptanceRequired: true }, 'completed')).toBe(true);
    expect(wentToAcceptance({ status: 'awaiting_completion_approval' }, 'completed')).toBe(true);
    expect(wentToAcceptance({ status: 'awaiting_completion_approval' }, 'in_progress')).toBe(false);
    expect(wentToAcceptance(null, 'completed')).toBe(false);
  });
});
