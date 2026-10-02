import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerApprovalCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const VO = {
  id: 31, orgId: 3, productId: 12, targetType: 'RELEASE', targetId: 7, title: '发布审批：v1.2 发布 (1.2.0)',
  requestedBy: 11, status: 'pending', canDecide: true, canCancel: true, selfApproved: false,
  createdAt: '2026-09-19T10:00:00',
};
const approval = (args: string[], response = ok(VO)) => runCli(registerApprovalCommands, ['approval', ...args], response);

beforeEach(() => {
  // the approval filter must NOT pick this up: it would silently narrow "what can I decide"
  process.env.GOOD7OB_PRODUCT_ID = '999';
});
afterEach(() => {
  delete process.env.GOOD7OB_PRODUCT_ID;
  vi.restoreAllMocks();
});

async function expectRejected(args: string[], needle: string) {
  const r = await approval(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('approval list', () => {
  const page = ok({
    records: [
      { ...VO },
      { id: 30, targetType: 'CHANGE_SET', targetId: 2, title: null, requestedBy: null, status: 'approved', canDecide: false, createdAt: '2026-09-18T09:30:00' },
      { id: 29, targetType: null, targetId: null, status: 'rejected', canDecide: null },
    ],
    total: 41, size: 20, current: 1, pages: 3,
  });

  it('sends paging defaults only, and does not use GOOD7OB_PRODUCT_ID', async () => {
    const r = await approval(['list'], page);
    expect(r.http.get).toHaveBeenCalledWith('/approvals', { params: { pageNum: 1, pageSize: 20 } });
  });

  it('renders rows: target as TYPE#id, booleans as 是/否/—, null as —', async () => {
    const r = await approval(['list'], page);
    expect(r.stdout).toMatch(/ID\s+状态\s+目标\s+标题\s+申请人\s+可决定\s+创建时间/);
    expect(r.stdout).toMatch(/31\s+pending\s+RELEASE#7\s+发布审批：v1\.2 发布 \(1\.2\.0\)\s+11\s+是\s+2026-09-19 10:00:00/);
    expect(r.stdout).toMatch(/30\s+approved\s+CHANGE_SET#2\s+—\s+—\s+否\s+2026-09-18 09:30:00/);
    expect(r.stdout).toMatch(/29\s+rejected\s+—\s+—\s+—\s+—\s+—/);
    expect(r.stdout).toContain('共 41 条，第 1/3 页');
  });

  it('passes every filter, normalising the target type to upper case', async () => {
    const r = await approval(['list', '--status', 'approved', '--target-type', 'release', '--target-id', '7',
      '--product', '12', '-p', '2', '--page-size', '100'], page);
    expect(r.http.get).toHaveBeenCalledWith('/approvals', {
      params: { pageNum: 2, pageSize: 100, status: 'approved', targetType: 'RELEASE', targetId: 7, productId: 12 },
    });
  });

  it('--target-type PRD passes through unchanged (case-insensitive, g7b #1061-D)', async () => {
    const r = await approval(['list', '--target-type', 'prd'], page);
    expect(r.http.get).toHaveBeenCalledWith('/approvals', {
      params: { pageNum: 1, pageSize: 20, targetType: 'PRD' },
    });
  });

  it('--mine sends mine=true (and tolerates --status pending)', async () => {
    const r = await approval(['list', '--mine'], page);
    expect(r.http.get).toHaveBeenCalledWith('/approvals', { params: { pageNum: 1, pageSize: 20, mine: true } });
    const both = await approval(['list', '--mine', '--status', 'pending'], page);
    expect(both.http.get).toHaveBeenCalledWith('/approvals', { params: { pageNum: 1, pageSize: 20, status: 'pending', mine: true } });
  });

  it.each([
    ['--mine with another status (backend would ignore it)', ['--mine', '--status', 'approved'], '--mine'],
    ['unknown status', ['--status', 'done'], '--status'],
    ['target type too short', ['--target-type', 'R'], '--target-type'],
    ['target type with a dash', ['--target-type', 'CHANGE-SET'], '--target-type'],
    ['non-numeric target id', ['--target-id', 'x'], '--target-id'],
    ['non-numeric product', ['--product', 'x'], '--product'],
    ['page size over 100', ['--page-size', '101'], '--page-size'],
    ['page size 0', ['--page-size', '0'], '--page-size'],
    ['page 0', ['--page', '0'], '--page'],
  ])('rejects %s before calling the API', (_n, args, needle) => expectRejected(['list', ...args], needle));

  it('prints raw JSON with --json and a message when empty', async () => {
    expect(JSON.parse((await approval(['list', '--json'], page)).stdout).total).toBe(41);
    expect((await approval(['list'], ok({ records: [], total: 0 }))).stdout).toContain('没有符合条件');
  });

  it('maps 2000 and 1001 from the server', async () => {
    expect((await approval(['list', '--product', '5'], bizError(2000, 'not my org'))).stderr).toContain('无权操作');
    expect((await approval(['list'], bizError(1001, 'bad'))).stderr).toContain('参数值不合法');
  });
});

describe('approval get', () => {
  it('GETs /{id} and shows what I may do', async () => {
    const r = await approval(['get', '31']);
    expect(r.http.get).toHaveBeenCalledWith('/approvals/31', { params: undefined });
    expect(r.stdout).toContain('审批 #31');
    expect(r.stdout).toContain('目标: RELEASE#7');
    expect(r.stdout).toContain('我能决定: 是    我能撤销: 是');
    expect(r.stdout).not.toContain('决定:     ');
  });

  it('shows the decision, comment and the self-approval warning of a decided request', async () => {
    const r = await approval(['get', '31'], ok({ ...VO, status: 'approved', decidedBy: 11, decidedAt: '2026-09-19T11:00:00',
      decisionComment: null, selfApproved: true, canDecide: false, canCancel: false }));
    expect(r.stdout).toContain('决定:     approved by 11 @ 2026-09-19 11:00:00');
    expect(r.stdout).toContain('意见:     —');
    expect(r.stdout).toContain('⚠ 自批');
    expect(r.stdout).toContain('我能决定: 否');
  });

  it('rejects a bad id; maps 1002', async () => {
    await expectRejected(['get', 'abc'], 'id');
    expect((await approval(['get', '99'], bizError(1002, 'nope'))).stderr).toContain('审批不存在');
  });
});

describe('approval approve', () => {
  const approved = ok({ ...VO, status: 'approved', canDecide: false });

  it('POSTs the optional comment', async () => {
    const r = await approval(['approve', '31', '--comment', 'LGTM'], approved);
    expect(r.http.post).toHaveBeenCalledWith('/approvals/31/approve', { comment: 'LGTM' });
    expect(r.stdout).toContain('审批 #31 已批准 (approved)');
    expect(r.stdout).not.toContain('自批');
  });

  it('sends an empty body without --comment and flags a self-approval', async () => {
    const r = await approval(['approve', '31'], ok({ ...VO, status: 'approved', selfApproved: true }));
    expect(r.http.post).toHaveBeenCalledWith('/approvals/31/approve', {});
    expect(r.stdout).toContain('自批');
  });

  it('prints the VO with --json', async () => {
    expect(JSON.parse((await approval(['approve', '31', '--json'], approved)).stdout).status).toBe('approved');
  });

  it('maps 1009 (already decided) and 2000 (forbidden / self-approval)', async () => {
    const decided = await approval(['approve', '31'], bizError(1009, '操作失败请重试'));
    expect(decided.exitCode).toBe(1);
    expect(decided.stderr).toContain('已被处理');
    expect(decided.stderr).toContain('approval get');
    const forbidden = await approval(['approve', '31'], bizError(2000, '不能批准自己的申请'));
    expect(forbidden.stderr).toContain('无权操作');
    expect(forbidden.stderr).toContain('不能批准自己的申请');
  });

  it('rejects a bad id', () => expectRejected(['approve', '0'], 'id'));
});

describe('approval reject', () => {
  it('POSTs the mandatory comment', async () => {
    const r = await approval(['reject', '31', '--comment', '范围不清'], ok({ ...VO, status: 'rejected' }));
    expect(r.http.post).toHaveBeenCalledWith('/approvals/31/reject', { comment: '范围不清' });
    expect(r.stdout).toContain('已驳回 (rejected)');
  });

  it('requires --comment (commander) and refuses a blank one before calling the API', async () => {
    const missing = await approval(['reject', '31']);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('required option');
    expect(noHttpCalls(missing)).toBe(true);
    await expectRejected(['reject', '31', '--comment', '   '], '--comment');
  });

  it('maps 1009 and 1000', async () => {
    expect((await approval(['reject', '31', '--comment', 'x'], bizError(1009, 'x'))).stderr).toContain('已被处理');
    expect((await approval(['reject', '31', '--comment', 'x'], bizError(1000, 'x'))).stderr).toContain('缺少必填参数');
  });
});

describe('approval cancel', () => {
  it('POSTs /{id}/cancel with no body and no prompt', async () => {
    const r = await approval(['cancel', '31'], ok({ ...VO, status: 'cancelled' }));
    expect(r.http.post).toHaveBeenCalledWith('/approvals/31/cancel', undefined);
    expect(r.stdout).toContain('已撤销 (cancelled)');
  });

  it('maps 1009 and 2000, rejects a bad id, prints JSON', async () => {
    expect((await approval(['cancel', '31'], bizError(1009, 'x'))).stderr).toContain('已被处理');
    expect((await approval(['cancel', '31'], bizError(2000, 'x'))).stderr).toContain('无权操作');
    await expectRejected(['cancel', 'x'], 'id');
    expect(JSON.parse((await approval(['cancel', '31', '--json'])).stdout).id).toBe(31);
  });
});
