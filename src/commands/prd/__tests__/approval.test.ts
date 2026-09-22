/**
 * Tests for the PRD approval commands (g7b #1061-D, good7ob/backend#282):
 * `prd request-approval`, `prd approval-status`, `prd approval-document`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPrdCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const prd = (args: string[], response = ok(null)) => runCli(registerPrdCommands, ['prd', ...args], response);

afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await prd(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('prd request-approval', () => {
  const approval = ok({
    id: 55, orgId: 3, productId: 7, targetType: 'PRD', targetId: 500,
    title: 'PRD 审批：Demo - PRD (v3)', status: 'pending',
  });

  it('POSTs the description and points at the new approval', async () => {
    const r = await prd(['request-approval', '500', '--description', 'please review'], approval);
    expect(r.http.post).toHaveBeenCalledWith('/forge/prd/500/request-approval', { description: 'please review' });
    expect(r.stdout).toContain('文档 #500 已提交审批');
    expect(r.stdout).toContain('审批 #55（good7ob approval get 55）');
  });

  it('sends an empty body without --description', async () => {
    const r = await prd(['request-approval', '500'], approval);
    expect(r.http.post).toHaveBeenCalledWith('/forge/prd/500/request-approval', {});
  });

  it('rejects a note over 2000 chars before calling the API', () =>
    expectRejected(['request-approval', '500', '--description', 'x'.repeat(2001)], '--description'));

  it('rejects a non-numeric document id before calling the API', () =>
    expectRejected(['request-approval', 'abc'], 'document-id'));

  it.each([
    [1001, '超过 2000 字'],
    [1002, '不属于你'],
    [1006, '已有待处理的审批申请'],
    [1007, '当前无法提交审批'],
    [2000, '不是该产品所属组织的有效成员'],
  ])('maps business code %i to a clear message', async (code, needle) => {
    const r = await prd(['request-approval', '500'], bizError(code, 'server text'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(needle);
  });
});

describe('prd approval-status', () => {
  it('GETs the state and reports it', async () => {
    const r = await prd(['approval-status', '500'], ok({ documentId: 500, status: 'pending', approvalId: 55 }));
    expect(r.http.get).toHaveBeenCalledWith('/forge/prd/500/approval', { params: undefined });
    expect(r.stdout).toContain('文档 #500 审批状态: pending');
    expect(r.stdout).toContain('审批 #55');
  });

  it('reports "none" without an approval id', async () => {
    const r = await prd(['approval-status', '500'], ok({ documentId: 500, status: 'none', approvalId: null }));
    expect(r.stdout).toContain('尚未提交审批');
  });

  it('prints JSON with --json', async () => {
    const state = { documentId: 500, status: 'approved', approvalId: 55 };
    const r = await prd(['approval-status', '500', '--json'], ok(state));
    expect(JSON.parse(r.stdout)).toEqual(state);
  });

  it('maps 1002 (not found / not yours)', async () => {
    const r = await prd(['approval-status', '500'], bizError(1002, 'x'));
    expect(r.stderr).toContain('不属于你');
  });
});

describe('prd approval-document', () => {
  const DOC = {
    approvalId: 55, documentId: 500, sessionId: 90, title: 'Demo - PRD', version: 'v3',
    docType: 'full', language: 'zh', locked: false, contentMd: '# Demo heading',
  };

  it('GETs through the approval id and renders the metadata + content', async () => {
    const r = await prd(['approval-document', '55'], ok(DOC));
    expect(r.http.get).toHaveBeenCalledWith('/forge/prd/approvals/55/document', { params: undefined });
    expect(r.stdout).toContain('审批 ID:  55');
    expect(r.stdout).toContain('文档 ID:  500');
    expect(r.stdout).toContain('标题:     Demo - PRD');
    expect(r.stdout).toContain('已锁定:   否');
    expect(r.stdout).toContain('# Demo heading');
    expect(r.stdout).not.toContain('这不是最新版本');
  });

  it('warns when isLatest is false, and stays quiet when it is absent', async () => {
    const stale = await prd(['approval-document', '55'], ok({ ...DOC, isLatest: false }));
    expect(stale.stdout).toContain('⚠ 这不是最新版本');
    const unknown = await prd(['approval-document', '55'], ok({ ...DOC }));
    expect(unknown.stdout).not.toContain('这不是最新版本');
  });

  it('prints JSON with --json', async () => {
    const r = await prd(['approval-document', '55', '--json'], ok(DOC));
    expect(JSON.parse(r.stdout)).toEqual(DOC);
  });

  it.each([
    [1002, '找不到该审批对应的 PRD'],
    [2000, '只有申请人或该组织的所有者/管理员'],
  ])('maps business code %i to a clear message', async (code, needle) => {
    const r = await prd(['approval-document', '55'], bizError(code, 'server text'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(needle);
  });

  it('rejects a non-numeric approval id before calling the API', () =>
    expectRejected(['approval-document', 'abc'], 'approval-id'));
});
