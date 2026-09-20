import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { registerTemplateCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const tpl = (args: string[], response = ok(null)) => runCli(registerTemplateCommands, ['template', ...args], response);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-manage-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());
const write = (name: string, text: string) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
};

async function expectRejected(args: string[], needle: string) {
  const r = await tpl(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const created = { id: 21, name: '登录', status: 'DRAFT', templateType: 'TASK' };

describe('template create', () => {
  it('POSTs a metadata-only template (no content -> no version)', async () => {
    const r = await tpl(['create', '--name', ' 登录 ', '--type', 'task'], ok(created));
    expect(r.http.post).toHaveBeenCalledWith('/templates', { name: '登录', templateType: 'TASK' });
    expect(r.stdout).toContain('✓ 模板已创建 (DRAFT): #21 登录');
  });

  it('sends every metadata field, tags de-duplicated and trimmed, and the first version from files', async () => {
    const content = write('c.json', '{"tasks":[{"name":"a"}]}');
    const vars = write('v.json', '[{"name":"x","label":"X","type":"string"}]');
    const compat = write('k.json', '{"vue":"3"}');
    const r = await tpl([
      'create', '--name', 'N', '--type', 'TASK', '--description', 'D', '--category', '3', '--visibility', 'organization',
      '--org', '8', '--tags', 'Vue, vue ,ai,,', '--license', 'personal', '--version', '1.2.0', '--changelog', 'first',
      '--content-file', content, '--variables-file', vars, '--compatibility-file', compat,
    ], ok(created));
    expect(r.http.post).toHaveBeenCalledWith('/templates', {
      name: 'N', templateType: 'TASK', description: 'D', categoryId: 3, visibility: 'ORGANIZATION', orgId: 8, tags: ['Vue', 'ai'],
      licenseType: 'PERSONAL', version: '1.2.0', changelog: 'first', content: { tasks: [{ name: 'a' }] },
      variables: [{ name: 'x', label: 'X', type: 'string' }], compatibility: { vue: '3' },
    });
  });

  it('accepts inline --content', async () => {
    const r = await tpl(['create', '--name', 'N', '--type', 'PRD', '--content', '{"markdown":"# hi"}'], ok(created));
    expect(r.http.post).toHaveBeenCalledWith('/templates', { name: 'N', templateType: 'PRD', content: { markdown: '# hi' } });
  });

  it('validates at the boundary, before any request', async () => {
    const base = ['create', '--name', 'N', '--type', 'TASK'];
    await expectRejected(['create', '--name', ' ', '--type', 'TASK'], '--name 不能为空');
    await expectRejected(['create', '--name', 'x'.repeat(101), '--type', 'TASK'], '--name 最多 100');
    await expectRejected(['create', '--name', 'N', '--type', 'BLOG'], '--type 取值无效');
    await expectRejected([...base, '--visibility', 'SECRET'], '--visibility 取值无效');
    await expectRejected([...base, '--visibility', 'ORGANIZATION'], '请同时指定 --org');
    await expectRejected([...base, '--license', 'GPL'], '--license 取值无效');
    await expectRejected([...base, '--description', 'x'.repeat(2001)], '--description 最多 2000');
    await expectRejected([...base, '--category', '-1'], '--category 必须是正整数');
    await expectRejected([...base, '--tags', Array.from({ length: 11 }, (_, i) => `t${i}`).join(',')], '最多 10 个标签');
    await expectRejected([...base, '--tags', 'x'.repeat(31)], '最多 30 个字符');
    await expectRejected([...base, '--version', '1.0.0'], '需要同时提供 --content-file 或 --content');
    await expectRejected([...base, '--variables-file', write('vv.json', '[]')], '需要同时提供 --content-file 或 --content');
    await expectRejected([...base, '--content', '{}', '--version', '1.0'], '--version 必须是 x.y.z');
    await expectRejected([...base, '--content', '[1]'], 'content: 必须是 JSON 对象');
    await expectRejected([...base, '--content', '{bad'], 'content: 不是合法的 JSON');
    await expectRejected([...base, '--content', '{}', '--content-file', write('c2.json', '{}')], '不能同时使用');
    await expectRejected([...base, '--content', '{}', '--variables-file', write('v2.json', '{}')], 'variables: 必须是 JSON 数组');
  });

  it('rejects a depth bomb file, an oversize content file and a directory without sending anything', async () => {
    const bomb = write('bomb.json', '['.repeat(100_000) + ']'.repeat(100_000));
    await expectRejected(['create', '--name', 'N', '--type', 'TASK', '--content-file', bomb], '嵌套超过 32 层');
    const big = write('big.json', JSON.stringify({ markdown: 'x'.repeat(1024 * 1024 + 10) }));
    await expectRejected(['create', '--name', 'N', '--type', 'PRD', '--content-file', big], '超过上限 1048576');
    await expectRejected(['create', '--name', 'N', '--type', 'PRD', '--content-file', dir], '必须指向普通文件');
    await expectRejected(['create', '--name', 'N', '--type', 'PRD', '--content-file', path.join(dir, 'missing.json')], '无法读取');
    const tooManyVars = write('vars51.json', JSON.stringify(Array.from({ length: 51 }, (_, i) => ({ name: `v${i}` }))));
    await expectRejected(['create', '--name', 'N', '--type', 'PRD', '--content', '{}', '--variables-file', tooManyVars], '最多 50 个');
  });

  it('maps the create error codes (1003 commerce, 1006 duplicate name, 2000, 1001 with the JSON path)', async () => {
    const args = ['create', '--name', 'N', '--type', 'TASK'];
    expect((await tpl(args, bizError(1003, 'x'))).stderr).toContain('商业化未开放');
    expect((await tpl(args, bizError(1006, 'dup'))).stderr).toContain('同名模板');
    expect((await tpl(args, bizError(2000, 'no'))).stderr).toContain('无权限');
    const r = await tpl(args, bizError(1001, 'content.tasks[2].name: 不能为空'));
    expect(r.stderr).toContain('创建模板失败');
    expect(r.stderr).toContain('content.tasks[2].name: 不能为空');
  });

  it('--json prints the created template', async () => {
    expect(JSON.parse((await tpl(['create', '--name', 'N', '--type', 'TASK', '--json'], ok(created))).stdout)).toEqual(created);
  });
});

describe('template update / delete / archive / unarchive', () => {
  it('PUTs only the flags that were given', async () => {
    const r = await tpl(['update', '21', '--name', 'New', '--tags', 'a,b', '--visibility', 'public', '--resubmit-for-review'], ok({ id: 21 }));
    expect(r.http.put).toHaveBeenCalledWith('/templates/21', { name: 'New', visibility: 'PUBLIC', tags: ['a', 'b'], resubmitForReview: true });
    expect(r.stdout).toContain('✓ 模板已更新: #21');
  });

  it('--clear-tags replaces the tags with an empty list; not combinable with --tags', async () => {
    expect((await tpl(['update', '21', '--clear-tags'], ok({}))).http.put).toHaveBeenCalledWith('/templates/21', { tags: [] });
    await expectRejected(['update', '21', '--tags', 'a', '--clear-tags'], '--tags 与 --clear-tags 不能同时使用');
  });

  it('refuses an empty update and bad values', async () => {
    await expectRejected(['update', '21'], '没有要修改的字段');
    await expectRejected(['update', '0', '--name', 'x'], 'id 必须是正整数');
    await expectRejected(['update', '21', '--name', ' '], '--name 不能为空');
    await expectRejected(['update', '21', '--license', 'X'], '--license 取值无效');
  });

  it('maps 1007 (archived / reviewing) and 1006', async () => {
    expect((await tpl(['update', '21', '--name', 'x'], bizError(1007, 's'))).stderr).toContain('当前状态不允许');
    expect((await tpl(['update', '21', '--name', 'x'], bizError(1006, 'd'))).stderr).toContain('同名模板');
  });

  it('delete DELETEs and reports; --json gives {deleted,id}', async () => {
    const r = await tpl(['delete', '21'], ok(null));
    expect(r.http.delete).toHaveBeenCalledWith('/templates/21', undefined);
    expect(r.stdout).toContain('✓ 模板已删除: #21');
    expect(JSON.parse((await tpl(['delete', '21', '--json'])).stdout)).toEqual({ deleted: true, id: 21 });
    expect((await tpl(['delete', '21'], bizError(1007, 'has instances'))).stderr).toContain('模板已有实例不可删除');
    await expectRejected(['delete', 'x'], 'id 必须是正整数');
  });

  it('archive / unarchive POST to the lifecycle endpoints and show the new status', async () => {
    const a = await tpl(['archive', '21'], ok({ id: 21, status: 'ARCHIVED' }));
    expect(a.http.post).toHaveBeenCalledWith('/templates/21/archive', undefined);
    expect(a.stdout).toContain('✓ 模板 #21 已归档 → ARCHIVED');
    const u = await tpl(['unarchive', '21'], ok({ id: 21, status: 'PUBLISHED' }));
    expect(u.http.post).toHaveBeenCalledWith('/templates/21/unarchive', undefined);
    expect(u.stdout).toContain('已恢复 → PUBLISHED');
    expect((await tpl(['archive', '21'], bizError(1007, 'reviewing'))).exitCode).toBe(1);
  });
});

describe('template favorite / unfavorite', () => {
  it('POST / DELETE the favorite endpoint and show the count', async () => {
    const f = await tpl(['favorite', '4'], ok({ templateId: 4, favorited: true, favoriteCount: 10 }));
    expect(f.http.post).toHaveBeenCalledWith('/templates/4/favorite', undefined);
    expect(f.stdout).toContain('✓ 模板 #4 已收藏，当前收藏数: 10');
    const u = await tpl(['unfavorite', '4'], ok({ templateId: 4, favorited: false, favoriteCount: 9 }));
    expect(u.http.delete).toHaveBeenCalledWith('/templates/4/favorite', undefined);
    expect(u.stdout).toContain('已取消收藏，当前收藏数: 9');
    expect((await tpl(['favorite', '4'], ok(null))).stdout).toContain('当前收藏数: —');
  });

  it('a template outside my library is 1002; a bad id never reaches the server', async () => {
    expect((await tpl(['favorite', '4'], bizError(1002, 'nf'))).stderr).toContain('不存在，或对你不可见');
    await expectRejected(['favorite', '0'], 'id 必须是正整数');
  });
});
