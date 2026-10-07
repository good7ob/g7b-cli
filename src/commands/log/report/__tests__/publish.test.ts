import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerAgentReportCommands } from '../index';
import { bizError, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerAgentReportCommands(program.command('log'));
const publish = (args: string[], response = ok(null)) => runCli(register, ['log', 'report', 'publish', ...args], response);

afterEach(() => vi.restoreAllMocks());

describe('log report publish', () => {
  it('单个 id 仍走单个发布接口', async () => {
    const r = await publish(['7']);
    expect(r.exitCode).toBeUndefined();
    expect(r.http.put.mock.calls[0][0]).toBe('/forge/agent-work-reports/7/publish');
    expect(r.http.post).not.toHaveBeenCalled();
    expect(r.stdout).toContain('报告已发布: 7');
  });

  it('多个 id 走批量接口并汇总成功与失败，有失败时退出码为 1', async () => {
    const r = await publish(
      ['1', '2', '3'],
      ok({ published: [1, 2], failed: [{ id: 3, reason: 'No permission to publish report: 3' }] })
    );
    expect(r.http.post.mock.calls[0][0]).toBe('/forge/agent-work-reports/batch-publish');
    expect(r.http.post.mock.calls[0][1]).toEqual({ ids: [1, 2, 3] });
    expect(r.stdout).toContain('已发布 2 份');
    expect(r.stderr).toContain('3');
    expect(r.stderr).toContain('No permission');
    expect(r.exitCode).toBe(1);
  });

  it('全部成功时退出码不为 1', async () => {
    const r = await publish(['1', '2'], ok({ published: [1, 2], failed: [] }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('已发布 2 份');
  });

  it('id 不是数字时报参数错误且不发请求', async () => {
    const r = await publish(['1', 'abc']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('abc');
    expect(r.http.post).not.toHaveBeenCalled();
    expect(r.http.put).not.toHaveBeenCalled();
  });

  it('业务错误时退出码为 1', async () => {
    const r = await publish(['1', '2'], bizError(500, 'ids must contain 1-100 report ids'));
    expect(r.exitCode).toBe(1);
  });
});
