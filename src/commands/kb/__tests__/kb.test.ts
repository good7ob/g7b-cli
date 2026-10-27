import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerKbCommands } from '../index';
import { runCli } from '../../../utils/__tests__/cliHarness';

afterEach(() => vi.restoreAllMocks());

// kb endpoints return bare bodies; /forge/prd/* is enveloped
const raw = (body: unknown) => body as never;

describe('kb', () => {
  it('list prints bare-array body', async () => {
    const r = await runCli(registerKbCommands, ['kb', 'list'], raw([{ id: 1, name: 'a.md', status: 'ready' }]) as never);
    expect(r.stdout).toContain('a.md');
  });

  it('list surfaces an enveloped failure instead of printing it', async () => {
    const r = await runCli(registerKbCommands, ['kb', 'list'], { success: false, code: 2000, msg: '知识库不存在或无权访问' } as never);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('知识库不存在或无权访问');
  });

  it('sync-prd rejects a bad id before any HTTP call', async () => {
    const r = await runCli(registerKbCommands, ['kb', 'sync-prd', 'x', '--product-id', '1']);
    expect(r.exitCode).toBe(1);
    expect(r.http.get).not.toHaveBeenCalled();
  });

  it('sync-prd fetches the PRD then posts title/content', async () => {
    const r = await runCli(registerKbCommands, ['kb', 'sync-prd', '5', '--product-id', '2'], (m, url) =>
      url.startsWith('/forge/prd/')
        ? { code: 200, data: { title: 'T', contentMd: 'C' } }
        : (({ id: 9, status: 'processing' }) as never));
    expect(r.http.post).toHaveBeenCalledWith('/forge/kb/sync/prd', { prdId: 5, productId: 2, title: 'T', content: 'C' }, expect.anything());
    expect(r.stdout).toContain('已同步');
  });

  it('upload requires an existing file', async () => {
    const r = await runCli(registerKbCommands, ['kb', 'upload', '/nope.md', '--product-id', '1']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('文件不存在');
  });

  it('search sends q/productId/limit and prints hits', async () => {
    const r = await runCli(registerKbCommands, ['kb', 'search', '登录', '流程', '--product-id', '10', '--org-id', '58'],
      { query: '登录 流程', results: [{ documentId: '9', documentName: 'PRD-认证', content: '正文片段', score: 0.8123 }] } as never);
    expect(r.http.get).toHaveBeenCalledWith('/forge/kb/search', expect.objectContaining({
      params: { q: '登录 流程', productId: 10, limit: 10 },
      headers: expect.objectContaining({ 'X-Tenant-Id': '58' }),
    }));
    expect(r.stdout).toContain('0.812');
    expect(r.stdout).toContain('正文片段');
  });

  it('search requires --product-id', async () => {
    const r = await runCli(registerKbCommands, ['kb', 'search', 'x']);
    expect(r.exitCode).toBe(1);
    expect(r.http.get).not.toHaveBeenCalled();
  });
});
