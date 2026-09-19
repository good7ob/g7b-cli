import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerIdeaCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const idea = (args: string[], response = ok(null)) => runCli(registerIdeaCommands, ['idea', ...args], response);

afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await idea(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('idea restore', () => {
  it('POSTs /restore and reports the resulting status', async () => {
    const r = await idea(['restore', '5'], ok({ id: 5, status: 'draft' }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/restore', undefined);
    expect(r.stdout).toContain('已恢复 (draft)');
  });

  it('validates the id, prints JSON, and maps 1007 / 1009', async () => {
    await expectRejected(['restore', 'abc'], 'id');
    const json = await idea(['restore', '5', '--json'], ok({ id: 5, status: 'draft' }));
    expect(JSON.parse(json.stdout).status).toBe('draft');
    expect((await idea(['restore', '5'], bizError(1007, 'has requirement'))).stderr).toContain('当前状态不允许');
    expect((await idea(['restore', '5'], bizError(1009, 'race'))).stderr).toContain('请重试');
  });
});

describe('idea merge', () => {
  const merged = ok({ sourceIdeaId: 5, targetIdeaId: 22, movedSolutions: 2, movedComments: 3, movedAttachments: 0, movedTags: null });

  it('POSTs targetIdeaId and summarises what moved, null as —', async () => {
    const r = await idea(['merge', '5', '--into', '22'], merged);
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/merge', { targetIdeaId: 22 });
    expect(r.stdout).toContain('#5 已合并到 #22');
    expect(r.stdout).toContain('方案 2 / 评论 3 / 附件 0 / 标签 —');
  });

  it('requires --into, and refuses a bad or identical target', async () => {
    const missing = await idea(['merge', '5']);
    expect(missing.stderr).toContain('required option');
    expect(noHttpCalls(missing)).toBe(true);
    await expectRejected(['merge', '5', '--into', 'x'], '--into');
    await expectRejected(['merge', '5', '--into', '5'], '自身');
  });

  it('maps 1006 (pending decision), 1007 (not draft/evaluating), 1001 (cross product)', async () => {
    expect((await idea(['merge', '5', '--into', '22'], bizError(1006, 'pending'))).stderr).toContain('待审批的决策');
    expect((await idea(['merge', '5', '--into', '22'], bizError(1007, 'state'))).stderr).toContain('当前状态不允许');
    expect((await idea(['merge', '5', '--into', '22'], bizError(1001, 'other product'))).stderr).toContain('参数值不合法');
  });

  it('--json prints the raw result', async () => {
    expect(JSON.parse((await idea(['merge', '5', '--into', '22', '--json'], merged)).stdout).movedComments).toBe(3);
  });
});

describe('idea duplicates', () => {
  const list = ok([
    { ideaId: 22, title: '订单导出 Excel', status: 'draft', similarity: 0.67 },
    { ideaId: 23, title: null, status: null, similarity: null },
  ]);

  it('GETs /duplicates, with --limit only when given', async () => {
    const plain = await idea(['duplicates', '5'], list);
    expect(plain.http.get).toHaveBeenCalledWith('/forge/ideas/5/duplicates', { params: undefined });
    expect(plain.stdout).toMatch(/22\s+0\.67\s+draft\s+订单导出 Excel/);
    expect(plain.stdout).toMatch(/23\s+—\s+—\s+—/);
    const limited = await idea(['duplicates', '5', '--limit', '20'], list);
    expect(limited.http.get).toHaveBeenCalledWith('/forge/ideas/5/duplicates', { params: { limit: 20 } });
  });

  it.each(['0', '21', 'x'])('rejects --limit %s', async (limit) => {
    await expectRejected(['duplicates', '5', '--limit', limit], '--limit');
  });

  it('says so when nothing is similar, and prints JSON', async () => {
    expect((await idea(['duplicates', '5'], ok([]))).stdout).toContain('没有疑似重复');
    expect(JSON.parse((await idea(['duplicates', '5', '--json'], list)).stdout)).toHaveLength(2);
  });
});

describe('idea comment', () => {
  it('add POSTs content (+ parentId) and confirms', async () => {
    const r = await idea(['comment', 'add', '5', '--text', '同意', '--parent', '9'], ok({ id: 30 }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/comments', { content: '同意', parentId: 9 });
    expect(r.stdout).toContain('#30');
    const top = await idea(['comment', 'add', '5', '--text', 'hi'], ok({ id: 31 }));
    expect(top.http.post).toHaveBeenCalledWith('/forge/ideas/5/comments', { content: 'hi' });
  });

  it.each([
    ['blank text', ['--text', '  '], '--text'],
    ['text over 2000', ['--text', 'x'.repeat(2001)], '最多 2000'],
    ['bad parent', ['--text', 't', '--parent', '0'], '--parent'],
  ])('add rejects %s before calling the API', async (_n, extra, needle) => {
    await expectRejected(['comment', 'add', '5', ...extra], needle);
  });

  it('add requires --text; maps 1002 (parent not found) and 2000', async () => {
    const r = await idea(['comment', 'add', '5']);
    expect(r.stderr).toContain('required option');
    expect(noHttpCalls(r)).toBe(true);
    expect((await idea(['comment', 'add', '5', '--text', 't'], bizError(1002, 'no parent'))).stderr).toContain('不存在');
    expect((await idea(['comment', 'add', '5', '--text', 't'], bizError(2000, 'no'))).stderr).toContain('无权访问');
  });

  const page = ok({
    records: [
      { id: 9, authorId: 11, content: '第一条', parentId: null, createdAt: '2026-09-19 10:00:00' },
      { id: 10, authorId: null, content: null, parentId: 9, createdAt: null },
    ],
    total: 41, current: 2, size: 20, pages: 3,
  });

  it('list sends paging, renders replies and null as —', async () => {
    const r = await idea(['comment', 'list', '5', '-p', '2', '--page-size', '15'], page);
    expect(r.http.get).toHaveBeenCalledWith('/forge/ideas/5/comments', { params: { pageNum: 2, pageSize: 15 } });
    expect(r.stdout).toMatch(/9\s+11\s+2026-09-19 10:00:00\s+第一条/);
    expect(r.stdout).toMatch(/10\s+—\s+#9\s+—\s+—/);
    expect(r.stdout).toContain('共 41 条，第 2/3 页');
  });

  it('list defaults to page 1 / 20, validates paging, handles empty and --json', async () => {
    const r = await idea(['comment', 'list', '5'], page);
    expect(r.http.get).toHaveBeenCalledWith('/forge/ideas/5/comments', { params: { pageNum: 1, pageSize: 20 } });
    await expectRejected(['comment', 'list', '5', '--page-size', '101'], '--page-size');
    expect((await idea(['comment', 'list', '5'], ok({ records: [], total: 0 }))).stdout).toContain('还没有评论');
    expect(JSON.parse((await idea(['comment', 'list', '5', '--json'], page)).stdout).total).toBe(41);
  });

  it('delete issues DELETE, validates ids, maps 2000', async () => {
    const r = await idea(['comment', 'delete', '5', '9']);
    expect(r.http.delete).toHaveBeenCalledWith('/forge/ideas/5/comments/9', undefined);
    expect(r.stdout).toContain('已删除');
    await expectRejected(['comment', 'delete', '5', 'x'], 'commentId');
    expect((await idea(['comment', 'delete', '5', '9'], bizError(2000, 'not yours'))).stderr).toContain('无权访问');
  });
});

describe('idea attachment', () => {
  const URL = 'https://good7ob-files.s3.ap-northeast-1.amazonaws.com/public/2026/需求.pdf';
  const add = (extra: string[] = []) =>
    ['attachment', 'add', '5', '--name', '需求.pdf', '--url', URL, '--size', '102400', '--content-type', 'application/pdf', ...extra];

  it('add POSTs the metadata', async () => {
    const r = await idea(add(), ok({ id: 5 }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/attachments', {
      fileName: '需求.pdf', fileUrl: URL, sizeBytes: 102400, contentType: 'application/pdf',
    });
    expect(r.stdout).toContain('#5');
  });

  it('add accepts the other bucket host spellings and omits content-type when not given', async () => {
    for (const host of ['b.s3.amazonaws.com', 'b.s3-us-west-2.amazonaws.com']) {
      const r = await idea(['attachment', 'add', '5', '--name', 'a', '--url', `https://${host}/public/a.png`, '--size', '0']);
      expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/attachments', { fileName: 'a', fileUrl: `https://${host}/public/a.png`, sizeBytes: 0 });
    }
  });

  it.each([
    ['http', 'http://b.s3.ap-northeast-1.amazonaws.com/public/a.pdf'],
    ['a non-S3 host', 'https://evil.example.com/public/a.pdf'],
    ['an S3-lookalike host', 'https://b.s3.amazonaws.com.evil.com/public/a.pdf'],
    ['a query string', 'https://b.s3.amazonaws.com/public/a.pdf?X-Amz-Signature=abc'],
    ['a fragment', 'https://b.s3.amazonaws.com/public/a.pdf#x'],
    ['userinfo', 'https://user@b.s3.amazonaws.com/public/a.pdf'],
    ['a path outside /public/', 'https://b.s3.amazonaws.com/private/a.pdf'],
    ['a bare /public/', 'https://b.s3.amazonaws.com/public/'],
    ['path traversal', 'https://b.s3.amazonaws.com/public/../secret.pdf'],
    ['encoded path traversal', 'https://b.s3.amazonaws.com/public/%2e%2e/secret.pdf'],
    ['an empty path segment', 'https://b.s3.amazonaws.com/public//a.pdf'],
    ['no scheme', 'b.s3.amazonaws.com/public/a.pdf'],
  ])('add rejects %s before calling the API', async (_n, url) => {
    await expectRejected(['attachment', 'add', '5', '--name', 'a', '--url', url, '--size', '1'], '--url');
  });

  it.each([
    ['size over 20 MiB', ['--size', '20971521'], '--size'],
    ['negative size', ['--size', '-1'], '--size'],
    ['non numeric size', ['--size', 'big'], '--size'],
    ['name over 255', ['--name', 'x'.repeat(256)], '--name'],
    ['content-type over 100', ['--content-type', 'x'.repeat(101)], '--content-type'],
    ['url over 1000', ['--url', `https://b.s3.amazonaws.com/public/${'x'.repeat(1000)}`], '--url'],
  ])('add rejects %s', async (_n, override, needle) => {
    // later flags win in commander, so an override after the valid set replaces it
    await expectRejected(add(override), needle);
  });

  it('add maps 1007 (more than 20 attachments) and requires the flags', async () => {
    expect((await idea(add(), bizError(1007, '>20'))).stderr).toContain('当前状态不允许');
    const r = await idea(['attachment', 'add', '5', '--name', 'a']);
    expect(r.stderr).toContain('required option');
    expect(noHttpCalls(r)).toBe(true);
  });

  const files = ok([
    { id: 5, fileName: '需求.pdf', fileUrl: URL, contentType: 'application/pdf', sizeBytes: 102400, uploadedBy: 11, createdAt: '2026-09-19 10:00:00' },
    { id: 6, fileName: null, fileUrl: null, contentType: null, sizeBytes: null, uploadedBy: null, createdAt: null },
  ]);

  it('list renders sizes humanised and null as —', async () => {
    const r = await idea(['attachment', 'list', '5'], files);
    expect(r.http.get).toHaveBeenCalledWith('/forge/ideas/5/attachments', { params: undefined });
    expect(r.stdout).toMatch(/5\s+需求\.pdf\s+application\/pdf\s+100 KB\s+11\s+2026-09-19 10:00:00\s+https:\/\//);
    expect(r.stdout).toMatch(/6\s+—\s+—\s+—\s+—\s+—\s+—/);
    expect((await idea(['attachment', 'list', '5'], ok([]))).stdout).toContain('还没有附件');
    expect(JSON.parse((await idea(['attachment', 'list', '5', '--json'], files)).stdout)).toHaveLength(2);
  });

  it('delete issues DELETE and validates ids', async () => {
    const r = await idea(['attachment', 'delete', '5', '6']);
    expect(r.http.delete).toHaveBeenCalledWith('/forge/ideas/5/attachments/6', undefined);
    await expectRejected(['attachment', 'delete', '5', '0'], 'attachmentId');
  });
});

describe('idea tag set', () => {
  it('PUTs the normalised list and shows the server result', async () => {
    const r = await idea(['tag', 'set', '5', '--tags', 'Backend, ai ,backend'], ok(['backend', 'ai']));
    expect(r.http.put).toHaveBeenCalledWith('/forge/ideas/5/tags', { tags: ['backend', 'ai'] });
    expect(r.stdout).toContain('标签: backend, ai');
  });

  it('an empty string clears the tags', async () => {
    const r = await idea(['tag', 'set', '5', '--tags', ''], ok([]));
    expect(r.http.put).toHaveBeenCalledWith('/forge/ideas/5/tags', { tags: [] });
    expect(r.stdout).toContain('标签: —');
  });

  it.each([
    ['more than 10 distinct tags', Array.from({ length: 11 }, (_, i) => `t${i}`).join(','), '最多 10'],
    ['a tag over 30 chars', 'x'.repeat(31), '1~30'],
    ['an empty item', 'a,,b', '(空)'],
  ])('rejects %s', async (_n, tags, needle) => {
    await expectRejected(['tag', 'set', '5', '--tags', tags], needle);
  });

  it('10 tags with duplicates folded is fine; requires --tags; maps 1001 / 2000', async () => {
    const ten = [...Array.from({ length: 10 }, (_, i) => `t${i}`), 'T0'].join(',');
    expect((await idea(['tag', 'set', '5', '--tags', ten], ok([]))).http.put).toHaveBeenCalled();
    const r = await idea(['tag', 'set', '5']);
    expect(r.stderr).toContain('required option');
    expect((await idea(['tag', 'set', '5', '--tags', 'a'], bizError(1001, 'bad tag'))).stderr).toContain('参数值不合法');
    expect((await idea(['tag', 'set', '5', '--tags', 'a'], bizError(2000, 'no'))).stderr).toContain('无权访问');
  });

  it('--json prints the tags', async () => {
    expect(JSON.parse((await idea(['tag', 'set', '5', '--tags', 'a', '--json'], ok(['a']))).stdout)).toEqual(['a']);
  });
});

describe('idea relation', () => {
  it('add POSTs relatedIdeaId + relationType', async () => {
    const r = await idea(['relation', 'add', '5', '--to', '22', '--type', 'duplicate_of'], ok({ id: 3 }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas/5/relations', { relatedIdeaId: 22, relationType: 'duplicate_of' });
    expect(r.stdout).toContain('#3');
    expect(r.stdout).toContain('#5 —duplicate_of→ #22');
  });

  it.each([
    ['unknown type', ['--to', '22', '--type', 'parent'], '--type'],
    ['non numeric target', ['--to', 'x', '--type', 'related'], '--to'],
    ['self relation', ['--to', '5', '--type', 'related'], '自关联'],
  ])('add rejects %s before calling the API', async (_n, extra, needle) => {
    await expectRejected(['relation', 'add', '5', ...extra], needle);
  });

  it('add requires --to and --type; maps 1006 (duplicate relation) and 1002', async () => {
    const r = await idea(['relation', 'add', '5', '--to', '22']);
    expect(r.stderr).toContain('required option');
    expect(noHttpCalls(r)).toBe(true);
    const args = ['relation', 'add', '5', '--to', '22', '--type', 'related'];
    expect((await idea(args, bizError(1006, 'exists'))).stderr).toContain('数据已存在');
    expect((await idea(args, bizError(1002, 'nope'))).stderr).toContain('不存在');
  });

  const rels = ok([
    { id: 3, relationType: 'duplicate_of', direction: 'outgoing', otherIdeaId: 22, otherTitle: '订单导出', otherStatus: 'draft' },
    { id: 4, relationType: 'blocks', direction: 'incoming', otherIdeaId: 23, otherTitle: null, otherStatus: null },
    { id: 5, relationType: null, direction: null, otherIdeaId: null },
  ]);

  it('list shows direction arrows and null as —', async () => {
    const r = await idea(['relation', 'list', '5'], rels);
    expect(r.http.get).toHaveBeenCalledWith('/forge/ideas/5/relations', { params: undefined });
    expect(r.stdout).toMatch(/3\s+→ duplicate_of\s+#22\s+draft\s+订单导出/);
    expect(r.stdout).toMatch(/4\s+← blocks\s+#23\s+—\s+—/);
    expect(r.stdout).toMatch(/5\s+\? —\s+—\s+—\s+—/);
    expect((await idea(['relation', 'list', '5'], ok([]))).stdout).toContain('没有关联');
    expect(JSON.parse((await idea(['relation', 'list', '5', '--json'], rels)).stdout)).toHaveLength(3);
  });

  it('remove issues DELETE and validates ids', async () => {
    const r = await idea(['relation', 'remove', '5', '3']);
    expect(r.http.delete).toHaveBeenCalledWith('/forge/ideas/5/relations/3', undefined);
    expect(r.stdout).toContain('已删除');
    await expectRejected(['relation', 'remove', '5', 'x'], 'relationId');
  });
});
