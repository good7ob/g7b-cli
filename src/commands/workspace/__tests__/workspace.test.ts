import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWorkspaceCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const queue = (args: string[], response = ok({ total: 0, counts: {}, items: [] })) =>
  runCli(registerWorkspaceCommands, ['workspace', 'queue', ...args], response);

afterEach(() => vi.restoreAllMocks());

const data = {
  total: 120,
  counts: { PLAN_APPROVAL: 3, COMPLETION_APPROVAL: 0, INFO_REQUEST: 1, BLOCKED: 0, PAUSED: 0, SYSTEM_ALERT: 5, REQUIREMENT_TRIAGE: 111 },
  items: [
    { sourceType: 'TASK', sourceId: 9, title: '审批计划', actionType: 'PLAN_APPROVAL', priority: 'HIGH', projectId: 4, projectName: '主项目', createdAt: '2026-09-19T10:00:00' },
    { sourceType: 'REQUIREMENT', sourceId: 3, title: '导出功能', actionType: 'REQUIREMENT_TRIAGE', priority: null, projectId: null, projectName: null, createdAt: '2026-09-18T10:00:00' },
  ],
};

describe('workspace queue', () => {
  it('GETs /workspace/my-queue with the default limit of 50', async () => {
    const r = await queue([], ok(data));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-queue', { params: { limit: 50 } });
    expect(r.exitCode).toBeUndefined();
  });

  it('passes --limit through', async () => {
    const r = await queue(['--limit', '200'], ok(data));
    expect(r.http.get).toHaveBeenCalledWith('/workspace/my-queue', { params: { limit: 200 } });
  });

  it.each(['0', '201', '-3', 'abc', '1.5'])('rejects --limit %s before calling the API', async (bad) => {
    const r = await queue(['--limit', bad]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--limit');
    expect(noHttpCalls(r)).toBe(true);
  });

  it('shows a counts summary (zero is 0) and the item table (null -> —)', async () => {
    const r = await queue([], ok(data));
    expect(r.stdout).toContain('待我处理: 120');
    expect(r.stdout).toContain('计划审批 3');
    expect(r.stdout).toContain('完成审批 0');
    expect(r.stdout).toContain('需求分诊 111');
    expect(r.stdout).toMatch(/TASK\s+9\s+计划审批\s+HIGH\s+主项目\s+审批计划/);
    expect(r.stdout).toMatch(/REQUIREMENT\s+3\s+需求分诊\s+—\s+—\s+导出功能/);
    expect(r.stdout).toContain('显示 2 / 120 条');
  });

  it('shows — (not 0) for a count the backend did not send', async () => {
    const r = await queue([], ok({ total: 1, counts: { PLAN_APPROVAL: 1 }, items: [] }));
    expect(r.stdout).toContain('计划审批 1');
    expect(r.stdout).toContain('完成审批 —');
    expect(r.stdout).toContain('队列为空');
  });

  it('renders array-form timestamps (as the live dev API returns them)', async () => {
    const r = await queue([], ok({ total: 1, counts: {}, items: [{ sourceType: 'REQUIREMENT', sourceId: 26, title: 't', actionType: 'REQUIREMENT_TRIAGE', createdAt: [2026, 8, 24, 14, 18, 43, 705186000] }] }));
    expect(r.stdout).toContain('2026-08-24 14:18:43');
    expect(r.stdout).not.toContain('705186000');
  });

  it('prints raw JSON with --json', async () => {
    const r = await queue(['--json'], ok(data));
    expect(JSON.parse(r.stdout).counts.SYSTEM_ALERT).toBe(5);
  });

  it('maps not-logged-in (999 and 400) errors', async () => {
    const a = await queue([], bizError(999, 'x'));
    expect(a.exitCode).toBe(1);
    expect(a.stderr).toContain('未登录');
    const b = await queue([], bizError(400, 'userId header is required'));
    expect(b.stderr).toContain('userId');
  });
});
