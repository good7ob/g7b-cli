import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTemplateCommands } from '../index';
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

const card = {
  id: 4, name: '登录功能开发', templateType: 'TASK', description: '登录流程任务清单', categoryId: 3, visibility: 'PUBLIC',
  status: 'PUBLISHED', ownerType: 'PLATFORM', ownerId: 0, orgId: null, isOfficial: true, pricingType: 'FREE', price: 0,
  licenseType: 'PERSONAL', publishedVersion: '1.0.0', ratingAvg: 4.5, reviewCount: 2, favoriteCount: 9, installCount: 0,
  instantiateCount: 0, viewCount: 130, tags: [{ id: 1, name: 'Vue', kind: 'TECH_STACK' }], favorited: false, canManage: false,
  suspendReason: null, createdBy: 0, publishedAt: '2026-09-20 10:00:00', createdAt: '2026-09-20 09:00:00', updatedAt: null,
};
const page = (records: unknown[], total = records.length) => ({ records, total, current: 1, size: 20, pages: 1 });

describe('template search', () => {
  it('GETs /templates with defaults and renders the table', async () => {
    const r = await tpl(['search'], ok(page([card])));
    expect(r.http.get).toHaveBeenCalledWith('/templates', { params: { pageNum: 1, pageSize: 20 } });
    expect(r.stdout).toMatch(/ID\s+类型\s+状态\s+可见\s+版本\s+评分\s+安装\s+名称/);
    expect(r.stdout).toMatch(/4\s+TASK\s+PUBLISHED\s+PUBLIC\s+1\.0\.0\s+4\.5 \(2\)\s+0\s+★ 登录功能开发/);
    expect(r.stdout).toContain('共 1 条，第 1/1 页');
  });

  it('maps every filter onto the backend query names', async () => {
    const r = await tpl([
      'search', '-k', 'login', '--type', 'task', '--category', '3', '--industry', 'fintech', '--tech-stack', 'Vue',
      '--language', 'zh', '--platform', 'web', '--pricing', 'free', '--min-rating', '3.5', '--author', '11', '--official',
      '--sort', 'POPULAR', '-p', '2', '--page-size', '50',
    ], ok(page([])));
    expect(r.http.get).toHaveBeenCalledWith('/templates', {
      params: {
        pageNum: 2, pageSize: 50, keyword: 'login', type: 'TASK', categoryId: 3, industry: 'fintech', techStack: 'Vue',
        language: 'zh', platform: 'web', pricingType: 'FREE', minRating: 3.5, authorId: 11, official: true, sort: 'popular',
      },
    });
    expect(r.stdout).toContain('没有符合条件的模板');
  });

  it('sends repeated tags as plain tag=a&tag=b (axios would send tag[]=..., which Spring does not bind)', async () => {
    const r = await tpl(['search', '--tag', 'Vue', '--tag', 'a b&c', '--no-official'], ok(page([])));
    expect(r.http.get).toHaveBeenCalledWith('/templates?tag=Vue&tag=a%20b%26c', { params: { pageNum: 1, pageSize: 20, official: false } });
  });

  it('validates flags before any request', async () => {
    await expectRejected(['search', '--type', 'BLOG'], '--type 取值无效');
    await expectRejected(['search', '--sort', 'newest'], '--sort 取值无效');
    await expectRejected(['search', '--pricing', 'FOREVER'], '--pricing 取值无效');
    await expectRejected(['search', '--min-rating', '6'], '--min-rating 必须在 0 到 5');
    await expectRejected(['search', '--min-rating', 'abc'], '--min-rating');
    await expectRejected(['search', '--category', '0'], '--category 必须是正整数');
    await expectRejected(['search', '--author', 'x'], '--author');
    await expectRejected(['search', '--page-size', '51'], '--page-size 必须在 1 到 50');
    await expectRejected(['search', '-p', '0'], '--page 必须在');
    await expectRejected(['search', ...Array.from({ length: 11 }, (_, i) => ['--tag', `t${i}`]).flat()], '--tag 最多 10 个');
    await expectRejected(['search', '--tag', 'x'.repeat(31)], '--tag 最多 30 个字符');
  });

  it('renders null / unrated as "—", never 0 (a 0.00 rating with no reviews is "no rating")', async () => {
    const bare = { id: 9, name: null, templateType: 'PRD', status: 'DRAFT', visibility: null, publishedVersion: null, ratingAvg: 0, reviewCount: 0, installCount: null };
    const r = await tpl(['search'], ok(page([bare])));
    expect(r.stdout).toMatch(/9\s+PRD\s+DRAFT\s+—\s+—\s+—\s+—\s+—/);
    expect(r.stdout).not.toMatch(/\b0\.00\b/);
  });

  it('--json prints the raw response; a bare array response also renders', async () => {
    const data = page([card]);
    expect(JSON.parse((await tpl(['search', '--json'], ok(data))).stdout)).toEqual(data);
    expect((await tpl(['search'], ok([card]))).stdout).toContain('登录功能开发');
  });

  it('maps 1001 / 999 to readable errors and keeps the server message', async () => {
    const r = await tpl(['search'], bizError(1001, '类型必须是 [PRD]'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('搜索模板失败');
    expect(r.stderr).toContain('参数值不合法');
    expect(r.stderr).toContain('类型必须是');
    expect((await tpl(['search'], bizError(999, 'x'))).stderr).toContain('未登录');
  });

  it('strips terminal escape sequences that a template name smuggles in', async () => {
    const esc = String.fromCharCode(27);
    const r = await tpl(['search'], ok(page([{ ...card, name: `evil${esc}[2Jname${String.fromCharCode(7)}` }])));
    expect(r.stdout).toContain('evilname');
    expect(r.stdout).not.toContain(esc);
  });
});

describe('template get', () => {
  const detail = {
    ...card,
    version: {
      id: 4, templateId: 4, version: '1.0.0', status: 'PUBLISHED', content: { tasks: [{ name: '建表' }] },
      variables: [{ name: 'project_name', label: '项目名称', type: 'string', required: true, default: 'good7ob' }],
      dependencies: [{ id: 1, versionId: 4, requiredTemplateId: 7, requiredTemplateName: null, minVersion: '1.0.0', kind: 'requires' }],
    },
  };

  it('GETs /templates/{id} and renders header, variables, dependencies and content', async () => {
    const r = await tpl(['get', '4'], ok(detail));
    expect(r.http.get).toHaveBeenCalledWith('/templates/4', { params: undefined });
    expect(r.stdout).toContain('模板 #4  ★ 登录功能开发');
    expect(r.stdout).toContain('评分: 4.5 (2)');
    expect(r.stdout).toContain('标签:     Vue');
    expect(r.stdout).toMatch(/project_name\s+string\s+是\s+good7ob\s+项目名称/);
    expect(r.stdout).toMatch(/#7\s+—\s+1\.0\.0\s+requires/); // name hidden -> "—"
    expect(r.stdout).toContain('"name": "建表"');
    expect(r.stdout).toContain('更新 —'); // updatedAt null
  });

  it('a template without a visible version says so; unrated shows "—"', async () => {
    const r = await tpl(['get', '4'], ok({ ...card, version: null, ratingAvg: 0, reviewCount: 0, canManage: true, suspendReason: '违规' }));
    expect(r.stdout).toContain('（暂无可查看的版本）');
    expect(r.stdout).toContain('评分: —');
    expect(r.stdout).toContain('可管理');
    expect(r.stdout).toContain('下架原因: 违规');
  });

  it('--version fetches that version instead (keyed by x.y.z)', async () => {
    const r = await tpl(['get', '4', '--version', '1.10.0'], ok(detail.version));
    expect(r.http.get).toHaveBeenCalledWith('/templates/4/versions/1.10.0', { params: undefined });
    expect(r.stdout).toContain('版本 1.0.0  [PUBLISHED]');
  });

  it('rejects a bad id and a bad --version before any request', async () => {
    await expectRejected(['get', 'abc'], 'id 必须是正整数');
    await expectRejected(['get', '4', '--version', '1.0'], '--version 必须是 x.y.z');
    await expectRejected(['get', '4', '--version', 'v1.0.0'], '--version 必须是 x.y.z');
  });

  it('maps 1002 (missing or not visible) and truncates very long content with a --json pointer', async () => {
    expect((await tpl(['get', '4'], bizError(1002, 'nf'))).stderr).toContain('不存在，或对你不可见');
    const big = { ...detail, version: { ...detail.version, content: { tasks: Array.from({ length: 100 }, (_, i) => ({ name: `t${i}` })) } } };
    const r = await tpl(['get', '4'], ok(big));
    expect(r.stdout).toContain('已省略');
    expect(r.stdout).toContain('--json');
    expect(JSON.parse((await tpl(['get', '4', '--json'], ok(big))).stdout).version.content.tasks).toHaveLength(100);
  });
});

describe('template mine / org / favorites / categories / tags', () => {
  it('mine passes status + type (case-insensitive) and paging', async () => {
    const r = await tpl(['mine', '--status', 'draft', '--type', 'prd', '-p', '3', '--page-size', '5'], ok(page([card], 12)));
    expect(r.http.get).toHaveBeenCalledWith('/templates/mine', { params: { pageNum: 3, pageSize: 5, status: 'DRAFT', type: 'PRD' } });
    expect(r.stdout).toContain('共 12 条，第 3/3 页');
    expect((await tpl(['mine'], ok(page([])))).stdout).toContain('你还没有创建模板');
    await expectRejected(['mine', '--status', 'live'], '--status 取值无效');
  });

  it('org GETs /templates/org/{orgId}; 2000 (not a member) is mapped', async () => {
    const r = await tpl(['org', '8', '--status', 'PUBLISHED'], ok(page([card])));
    expect(r.http.get).toHaveBeenCalledWith('/templates/org/8', { params: { pageNum: 1, pageSize: 20, status: 'PUBLISHED' } });
    expect((await tpl(['org', '8'], bizError(2000, 'not member'))).stderr).toContain('无权限');
    await expectRejected(['org', '0'], 'orgId 必须是正整数');
  });

  it('favorites GETs /templates/favorites', async () => {
    const r = await tpl(['favorites', '-p', '2'], ok(page([])));
    expect(r.http.get).toHaveBeenCalledWith('/templates/favorites', { params: { pageNum: 2, pageSize: 20 } });
    expect(r.stdout).toContain('还没有收藏');
  });

  it('categories renders the tree; --type filters (upper-cased)', async () => {
    const tree = [{ id: 1, parentId: null, templateType: 'TASK', code: 'task', name: '任务', children: [{ id: 5, code: 'task-web', name: 'Web', templateType: 'TASK', children: [] }] }];
    const r = await tpl(['categories', '--type', 'task'], ok(tree));
    expect(r.http.get).toHaveBeenCalledWith('/templates/categories', { params: { type: 'TASK' } });
    expect(r.stdout).toContain('#1 任务  (task, TASK)');
    expect(r.stdout).toContain('  #5 Web  (task-web, TASK)');
    expect((await tpl(['categories'], ok(tree))).http.get).toHaveBeenCalledWith('/templates/categories', { params: undefined });
    await expectRejected(['categories', '--type', 'x'], '--type 取值无效');
  });

  it('tags passes kind / keyword / limit and validates them', async () => {
    const r = await tpl(['tags', '--kind', 'tech_stack', '-k', 'vu', '--limit', '10'], ok([{ id: 1, name: 'Vue', kind: 'TECH_STACK' }, { id: 2, name: null, kind: null }]));
    expect(r.http.get).toHaveBeenCalledWith('/templates/tags', { params: { kind: 'TECH_STACK', keyword: 'vu', limit: 10 } });
    expect(r.stdout).toMatch(/1\s+TECH_STACK\s+Vue/);
    expect(r.stdout).toMatch(/2\s+—\s+—/);
    await expectRejected(['tags', '--limit', '101'], '--limit 必须在 1 到 100');
    await expectRejected(['tags', '--kind', 'FOO'], '--kind 取值无效');
  });
});
