import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTemplateCommands } from '../index';
import { ADMIN_HINT, withAdminHint } from '../adminCommands';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const tpl = (args: string[], response = ok(null)) => runCli(registerTemplateCommands, ['template', ...args], response);

afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await tpl(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const page = (records: unknown[], total = records.length) => ({ records, total, current: 1, size: 20, pages: 1 });

describe('template review', () => {
  it('add POSTs rating + comment to /templates/{id}/reviews', async () => {
    const r = await tpl(['review', 'add', '4', '--rating', '5', '--comment', '好用'], ok({ id: 1, templateId: 4, userId: 11, rating: 5, comment: '好用' }));
    expect(r.http.post).toHaveBeenCalledWith('/templates/4/reviews', { rating: 5, comment: '好用' });
    expect(r.stdout).toContain('✓ 已评价模板 #4: ★★★★★ — 好用');
  });

  it('comment is optional', async () => {
    const r = await tpl(['review', 'add', '4', '--rating', '3'], ok({ rating: 3, comment: null }));
    expect(r.http.post).toHaveBeenCalledWith('/templates/4/reviews', { rating: 3 });
    expect(r.stdout).toContain('★★★');
  });

  it('validates the rating range and comment length before any request', async () => {
    await expectRejected(['review', 'add', '4', '--rating', '0'], '--rating 必须在 1 到 5');
    await expectRejected(['review', 'add', '4', '--rating', '6'], '--rating 必须在 1 到 5');
    await expectRejected(['review', 'add', '4', '--rating', '4.5'], '--rating 必须是整数');
    await expectRejected(['review', 'add', '4', '--rating', '4', '--comment', 'x'.repeat(1001)], '--comment 最多 1000');
    await expectRejected(['review', 'add', 'x', '--rating', '4'], 'id 必须是正整数');
  });

  it('maps 2000 (not installed / own template) and 1002', async () => {
    const args = ['review', 'add', '4', '--rating', '4'];
    expect((await tpl(args, bizError(2000, '只有安装或使用过该模板的用户可以评价'))).stderr).toContain('未安装使用就评价');
    expect((await tpl(args, bizError(1002, 'nf'))).stderr).toContain('不存在，或对你不可见');
  });

  it('list GETs with paging and renders stars; null rating / comment -> "—"', async () => {
    const rows = [{ id: 1, userId: 11, rating: 4, comment: '不错', createdAt: '2026-09-20 10:00:00', updatedAt: '2026-09-20 12:00:00' }, { id: 2, userId: 12, rating: null, comment: null, createdAt: null }];
    const r = await tpl(['review', 'list', '4', '-p', '2', '--page-size', '10'], ok(page(rows, 25)));
    expect(r.http.get).toHaveBeenCalledWith('/templates/4/reviews', { params: { pageNum: 2, pageSize: 10 } });
    expect(r.stdout).toMatch(/1\s+11\s+★★★★\s+2026-09-20 12:00:00\s+不错/);
    expect(r.stdout).toMatch(/2\s+12\s+—\s+—\s+—/);
    expect(r.stdout).toContain('共 25 条，第 2/3 页');
    expect((await tpl(['review', 'list', '4'], ok(page([])))).stdout).toContain('暂无评价');
  });

  it('rm DELETEs my review', async () => {
    const r = await tpl(['review', 'rm', '4']);
    expect(r.http.delete).toHaveBeenCalledWith('/templates/4/reviews', undefined);
    expect(r.stdout).toContain('✓ 已删除我对模板 #4 的评价');
    expect(JSON.parse((await tpl(['review', 'rm', '4', '--json'])).stdout)).toEqual({ deleted: true, id: 4 });
    expect((await tpl(['review', 'rm', '4'], bizError(1002, 'none'))).exitCode).toBe(1);
  });
});

describe('template package', () => {
  const pkg = {
    id: 5, name: 'Web 起步包', description: '一组模板', visibility: 'PUBLIC', status: 'DRAFT', ownerType: 'USER', ownerId: 11, orgId: null,
    pricingType: 'FREE', isOfficial: false, installCount: 0, instantiateCount: null, canManage: true, createdBy: 11, createdAt: '2026-09-20 10:00:00',
    items: [
      { templateId: 4, templateName: '登录', templateType: 'TASK', templateStatus: 'PUBLISHED', publishedVersion: '1.0.0', versionConstraint: '^1.0.0', sortOrder: 0 },
      { templateId: 9, templateName: null, templateType: null, templateStatus: null, publishedVersion: null, versionConstraint: '*', sortOrder: 1 },
    ],
  };

  it('create POSTs name, visibility, org and items (constraint optional)', async () => {
    const r = await tpl(['package', 'create', '--name', ' Web 起步包 ', '--description', 'D', '--visibility', 'organization', '--org', '8', '--item', '4:^1.0.0', '--item', '9'], ok(pkg));
    expect(r.http.post).toHaveBeenCalledWith('/templates/packages', {
      name: 'Web 起步包', description: 'D', visibility: 'ORGANIZATION', orgId: 8,
      items: [{ templateId: 4, versionConstraint: '^1.0.0' }, { templateId: 9 }],
    });
    expect(r.stdout).toContain('✓ 模板包已创建 (DRAFT): #5 Web 起步包');
  });

  it('validates name, visibility / org, item syntax, constraint grammar, duplicates and the 30-item cap', async () => {
    await expectRejected(['package', 'create', '--name', ' '], '--name 不能为空');
    await expectRejected(['package', 'create', '--name', 'x'.repeat(101)], '--name 最多 100');
    await expectRejected(['package', 'create', '--name', 'N', '--visibility', 'ORGANIZATION'], '请同时指定 --org');
    await expectRejected(['package', 'create', '--name', 'N', '--item', 'abc'], "--item 的 templateId 必须是正整数");
    await expectRejected(['package', 'create', '--name', 'N', '--item', '4:latest'], '--item 的版本约束必须是');
    await expectRejected(['package', 'create', '--name', 'N', '--item', '4:=1.0.0'], '--item 的版本约束必须是');
    await expectRejected(['package', 'create', '--name', 'N', '--item', '4', '--item', '4:*'], '不能重复');
    await expectRejected(['package', 'create', '--name', 'N', ...Array.from({ length: 31 }, (_, i) => ['--item', String(i + 1)]).flat()], '--item 最多 30 个');
    for (const good of ['*', '1.2.3', '^1.2.3', '~1.2.3', '>=1.2.3']) {
      const r = await tpl(['package', 'create', '--name', 'N', '--item', `4:${good}`], ok(pkg));
      expect(r.exitCode).toBeUndefined();
    }
  });

  it('create maps 1003 / 1006 / 1002 (an item the caller cannot see)', async () => {
    const args = ['package', 'create', '--name', 'N'];
    expect((await tpl(args, bizError(1003, 'x'))).stderr).toContain('商业化未开放');
    expect((await tpl(args, bizError(1006, 'x'))).stderr).toContain('同名');
    expect((await tpl(args, bizError(1002, 'x'))).stderr).toContain('不存在，或对你不可见');
  });

  it('get renders items; hidden template details show "—"', async () => {
    const r = await tpl(['package', 'get', '5'], ok(pkg));
    expect(r.http.get).toHaveBeenCalledWith('/templates/packages/5', { params: undefined });
    expect(r.stdout).toContain('模板包 #5  Web 起步包');
    expect(r.stdout).toContain('热度:     安装 0  实例化 —');
    expect(r.stdout).toMatch(/#4\s+登录\s+TASK\s+PUBLISHED\s+1\.0\.0\s+\^1\.0\.0/);
    expect(r.stdout).toMatch(/#9\s+—\s+—\s+—\s+—\s+\*/);
    expect((await tpl(['package', 'get', '5'], ok({ ...pkg, items: [] }))).stdout).toContain('条目: —');
  });

  it('update sends only what changed; --item replaces all items; --clear-items sends []', async () => {
    const r = await tpl(['package', 'update', '5', '--name', 'New', '--item', '4:~1.0.0'], ok(pkg));
    expect(r.http.put).toHaveBeenCalledWith('/templates/packages/5', { name: 'New', items: [{ templateId: 4, versionConstraint: '~1.0.0' }] });
    expect((await tpl(['package', 'update', '5', '--clear-items'], ok(pkg))).http.put).toHaveBeenCalledWith('/templates/packages/5', { items: [] });
    await expectRejected(['package', 'update', '5'], '没有要修改的字段');
    await expectRejected(['package', 'update', '5', '--item', '4', '--clear-items'], '--item 与 --clear-items 不能同时使用');
  });

  it('delete / publish / archive hit their endpoints; 1007 / 1001 / 1009 are mapped', async () => {
    expect((await tpl(['package', 'delete', '5'])).http.delete).toHaveBeenCalledWith('/templates/packages/5', undefined);
    expect(JSON.parse((await tpl(['package', 'delete', '5', '--json'])).stdout)).toEqual({ deleted: true, id: 5 });
    const pub = await tpl(['package', 'publish', '5'], ok({ ...pkg, status: 'PUBLISHED' }));
    expect(pub.http.post).toHaveBeenCalledWith('/templates/packages/5/publish', undefined);
    expect(pub.stdout).toContain('✓ 模板包 #5 已发布 (PUBLISHED)');
    const arc = await tpl(['package', 'archive', '5'], ok({ ...pkg, status: 'ARCHIVED' }));
    expect(arc.http.post).toHaveBeenCalledWith('/templates/packages/5/archive', undefined);
    expect((await tpl(['package', 'publish', '5'], bizError(1001, '条目 x 的可见范围小于模板包的可见范围'))).stderr).toContain('可见范围小于模板包');
    expect((await tpl(['package', 'publish', '5'], bizError(1007, 'x'))).stderr).toContain('当前状态不允许');
    expect((await tpl(['package', 'publish', '5'], bizError(1009, 'x'))).stderr).toContain('并发冲突');
  });

  it('list: library by default, --mine, --org; keyword only for the library', async () => {
    const lib = await tpl(['package', 'list', '-k', 'web', '-p', '2'], ok(page([pkg], 21)));
    expect(lib.http.get).toHaveBeenCalledWith('/templates/packages', { params: { pageNum: 2, pageSize: 20, keyword: 'web' } });
    expect(lib.stdout).toMatch(/5\s+DRAFT\s+PUBLIC\s+0\s+2026-09-20 10:00:00\s+Web 起步包/);
    expect(lib.stdout).toContain('共 21 条，第 2/2 页');
    expect((await tpl(['package', 'list', '--mine'], ok(page([])))).http.get).toHaveBeenCalledWith('/templates/packages/mine', { params: { pageNum: 1, pageSize: 20 } });
    expect((await tpl(['package', 'list', '--org', '8'], ok(page([])))).http.get).toHaveBeenCalledWith('/templates/packages/org/8', { params: { pageNum: 1, pageSize: 20 } });
    expect((await tpl(['package', 'list'], ok(page([])))).stdout).toContain('没有模板包');
    await expectRejected(['package', 'list', '--mine', '--org', '8'], '--mine 与 --org 不能同时使用');
    await expectRejected(['package', 'list', '--mine', '-k', 'x'], '--keyword 只适用于模板包库');
    await expectRejected(['package', 'list', '--org', '0'], '--org 必须是正整数');
  });
});

describe('template admin', () => {
  const detail = { id: 4, name: '登录', status: 'PUBLISHED', publishedVersion: '1.0.0', version: { version: '1.0.0', status: 'PUBLISHED', content: { a: 1 } } };

  it('reviews GETs the queue and renders it (null cells "—")', async () => {
    const rows = [{ versionId: 9, version: '1.1.0', submittedAt: '2026-09-20 10:00:00', submittedBy: 11, templateId: 4, templateName: '登录', templateType: 'TASK', visibility: 'PUBLIC', templateStatus: 'PUBLISHED' }, { versionId: 10, templateId: 5 }];
    const r = await tpl(['admin', 'reviews', '-p', '1', '--page-size', '5'], ok(page(rows)));
    expect(r.http.get).toHaveBeenCalledWith('/admin/templates/reviews', { params: { pageNum: 1, pageSize: 5 } });
    expect(r.stdout).toMatch(/9\s+#4\s+TASK\s+1\.1\.0\s+PUBLISHED\s+2026-09-20 10:00:00\s+11\s+登录/);
    expect(r.stdout).toMatch(/10\s+#5\s+—\s+—\s+—\s+—\s+—\s+—/);
    expect((await tpl(['admin', 'reviews'], ok(page([])))).stdout).toContain('审核队列为空');
  });

  it('list GETs /admin/templates with status + keyword', async () => {
    const r = await tpl(['admin', 'list', '--status', 'suspended', '-k', 'log'], ok(page([])));
    expect(r.http.get).toHaveBeenCalledWith('/admin/templates', { params: { pageNum: 1, pageSize: 20, status: 'SUSPENDED', keyword: 'log' } });
    await expectRejected(['admin', 'list', '--status', 'live'], '--status 取值无效');
  });

  it('show GETs the review detail for a version id', async () => {
    const r = await tpl(['admin', 'show', '9'], ok(detail));
    expect(r.http.get).toHaveBeenCalledWith('/admin/templates/versions/9', { params: undefined });
    expect(r.stdout).toContain('模板 #4');
    expect(r.stdout).toContain('"a": 1');
    await expectRejected(['admin', 'show', 'x'], 'versionId 必须是正整数');
  });

  it('approve POSTs an optional comment (empty body when omitted)', async () => {
    const a = await tpl(['admin', 'approve', '9', '--comment', 'LGTM'], ok(detail));
    expect(a.http.post).toHaveBeenCalledWith('/admin/templates/versions/9/approve', { comment: 'LGTM' });
    expect(a.stdout).toContain('✓ 版本 #9 已批准并发布: 模板 #4 登录 1.0.0');
    expect((await tpl(['admin', 'approve', '9'], ok(detail))).http.post).toHaveBeenCalledWith('/admin/templates/versions/9/approve', {});
    await expectRejected(['admin', 'approve', '9', '--comment', 'x'.repeat(1001)], '--comment 最多 1000');
  });

  it('reject requires a reason (client side) and POSTs it as `comment`', async () => {
    const r = await tpl(['admin', 'reject', '9', '--reason', '缺少描述'], ok(detail));
    expect(r.http.post).toHaveBeenCalledWith('/admin/templates/versions/9/reject', { comment: '缺少描述' });
    expect(r.stdout).toContain('✓ 版本 #9 已驳回（退回 DRAFT）');
    const missing = await tpl(['admin', 'reject', '9']);
    expect(missing.exitCode).toBe(1);
    expect(noHttpCalls(missing)).toBe(true);
    await expectRejected(['admin', 'reject', '9', '--reason', '  '], '--reason 不能为空');
    await expectRejected(['admin', 'reject', '9', '--reason', 'x'.repeat(1001)], '--reason 最多 1000');
  });

  it('approve / reject map 1009 (already decided) and 1002', async () => {
    expect((await tpl(['admin', 'approve', '9'], bizError(1009, 'decided'))).stderr).toContain('已被处理或并发冲突');
    expect((await tpl(['admin', 'reject', '9', '--reason', 'r'], bizError(1002, 'nf'))).stderr).toContain('不存在');
  });

  it('suspend needs a reason; unsuspend takes an optional one', async () => {
    const s = await tpl(['admin', 'suspend', '4', '--reason', '违规内容'], ok({ id: 4, status: 'SUSPENDED' }));
    expect(s.http.post).toHaveBeenCalledWith('/admin/templates/4/suspend', { comment: '违规内容' });
    expect(s.stdout).toContain('✓ 模板 #4 已下架 (SUSPENDED)');
    await expectRejected(['admin', 'suspend', '4'], '--reason 不能为空');
    const u = await tpl(['admin', 'unsuspend', '4'], ok({ id: 4, status: 'PUBLISHED' }));
    expect(u.http.post).toHaveBeenCalledWith('/admin/templates/4/unsuspend', {});
    expect(u.stdout).toContain('已恢复上架 (PUBLISHED)');
    expect((await tpl(['admin', 'unsuspend', '4', '--reason', 'ok'], ok({ id: 4 }))).http.post).toHaveBeenCalledWith('/admin/templates/4/unsuspend', { comment: 'ok' });
    expect((await tpl(['admin', 'suspend', '4', '--reason', 'r'], bizError(1007, 'x'))).stderr).toContain('当前状态不允许');
  });

  it('a non-admin (business code 2000) gets the auth pointer, not just "forbidden"', async () => {
    const r = await tpl(['admin', 'reviews'], bizError(2000, 'not admin'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('获取审核队列失败');
    expect(r.stderr).toContain('GOOD7OB_API_KEY');
    expect(r.stderr).toContain('userType=admin');
  });

  it('withAdminHint: an HTTP 403 with no business code, or a permission message, gets the hint; other errors are untouched', () => {
    const forbidden = withAdminHint(new Error('Access denied: admin privileges required')) as Error;
    expect(forbidden.message).toContain('Access denied: admin privileges required');
    expect(forbidden.message).toContain(ADMIN_HINT);
    const untouched = new Error('boom');
    expect(withAdminHint(untouched)).toBe(untouched);
    const coded = Object.assign(new Error('nf'), { code: 1002 });
    expect(withAdminHint(coded)).toBe(coded);
    expect((withAdminHint(Object.assign(new Error('x'), { code: 2000 })) as { code?: number }).code).toBe(2000);
  });

  it('the hint is not added to non-admin commands', async () => {
    expect((await tpl(['search'], bizError(2000, 'x'))).stderr).not.toContain('GOOD7OB_API_KEY');
  });
});
