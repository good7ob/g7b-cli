import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { registerTemplateCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const tpl = (args: string[], response = ok(null)) => runCli(registerTemplateCommands, ['template', ...args], response);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-version-'));
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

const version = {
  id: 9, templateId: 4, version: '1.1.0', changelog: '加了描述', status: 'DRAFT', content: { tasks: [{ name: 'a' }] },
  variables: [], previousVersionId: 8, submittedAt: null, publishedAt: null, reviewResult: 'REJECTED', reviewComment: '缺少描述',
  reviewedBy: 900, reviewedAt: '2026-09-20 11:00:00', createdBy: 11, createdAt: '2026-09-20 10:00:00',
  dependencies: [{ id: 1, versionId: 9, requiredTemplateId: 7, requiredTemplateName: 'Base', minVersion: '1.0.0', kind: 'requires' }],
};

describe('template version add / update', () => {
  it('POSTs /templates/{id}/versions with version, changelog, content, variables', async () => {
    const content = write('c.json', '{"tasks":[{"name":"a"}]}');
    const vars = write('v.json', '[{"name":"p","label":"P","type":"string"}]');
    const r = await tpl(['version', 'add', '4', '--version', '1.1.0', '--changelog', 'log', '--content-file', content, '--variables-file', vars], ok(version));
    expect(r.http.post).toHaveBeenCalledWith('/templates/4/versions', {
      version: '1.1.0', changelog: 'log', content: { tasks: [{ name: 'a' }] }, variables: [{ name: 'p', label: 'P', type: 'string' }],
    });
    expect(r.stdout).toContain('✓ 版本已创建 (DRAFT): 模板 #4 1.1.0');
  });

  it('takes inline --content', async () => {
    const r = await tpl(['version', 'add', '4', '--version', '1.0.0', '--content', '{"format":"text","body":"x"}'], ok(version));
    expect(r.http.post).toHaveBeenCalledWith('/templates/4/versions', { version: '1.0.0', content: { format: 'text', body: 'x' } });
  });

  it('rejects everything invalid before a request: version, content presence, shape, limits', async () => {
    const ok1 = ['version', 'add', '4', '--version', '1.0.0'];
    await expectRejected(['version', 'add', '4', '--version', '1.0'], '--version 必须是 x.y.z');
    await expectRejected(['version', 'add', '4', '--version', '1.0.0-beta', '--content', '{}'], '--version 必须是 x.y.z');
    await expectRejected(['version', 'add', '4', '--version', '1234567.0.0', '--content', '{}'], '--version 必须是 x.y.z');
    await expectRejected(['version', 'add', 'x', '--version', '1.0.0', '--content', '{}'], 'id 必须是正整数');
    await expectRejected(ok1, '缺少内容');
    await expectRejected([...ok1, '--content', 'null'], 'content: 必须是 JSON 对象');
    await expectRejected([...ok1, '--changelog', 'x'.repeat(5001)], '--changelog 最多 5000');
    await expectRejected([...ok1, '--content', '{}', '--compatibility-file', write('k.json', JSON.stringify({ a: 'x'.repeat(5000) }))], 'compatibility');
    await expectRejected([...ok1, '--content', '{}', '--variables-file', write('v.json', '{"a":1}')], 'variables: 必须是 JSON 数组');
  });

  it('depth bomb / node bomb / oversize files never reach the server', async () => {
    const bomb = write('bomb.json', `{"a":${'['.repeat(50_000)}${']'.repeat(50_000)}}`);
    await expectRejected(['version', 'add', '4', '--version', '1.0.0', '--content-file', bomb], '嵌套超过 32 层');
    const wide = write('wide.json', `{"a":[${new Array(10_001).fill(1).join(',')}]}`);
    await expectRejected(['version', 'add', '4', '--version', '1.0.0', '--content-file', wide], '元素超过 10000 个');
    const many = write('many.json', `{"a":[${Array.from({ length: 6 }, () => `[${new Array(9000).fill(1).join(',')}]`).join(',')}]}`);
    await expectRejected(['version', 'add', '4', '--version', '1.0.0', '--content-file', many], '值超过 50000 个');
    const big = write('big.json', JSON.stringify({ markdown: 'x'.repeat(1_100_000) }));
    await expectRejected(['version', 'update', '4', '1.0.0', '--content-file', big], '超过上限 1048576');
    await expectRejected(['version', 'update', '4', '1.0.0', '--content-file', dir], '必须指向普通文件');
  });

  it('maps the version error codes', async () => {
    const args = ['version', 'add', '4', '--version', '1.0.0', '--content', '{}'];
    expect((await tpl(args, bizError(1006, 'dup'))).stderr).toContain('版本号重复');
    expect((await tpl(args, bizError(1007, 'archived'))).stderr).toContain('当前状态不允许');
    expect((await tpl(args, bizError(2000, 'ro'))).stderr).toContain('无权限');
    const r = await tpl(args, bizError(1001, 'content.tasks: 不能为空'));
    expect(r.stderr).toContain('创建版本失败');
    expect(r.stderr).toContain('content.tasks: 不能为空');
  });

  it('update PUTs to /versions/{x.y.z} with only the given fields', async () => {
    const r = await tpl(['version', 'update', '4', '1.10.0', '--changelog', 'fix', '--content', '{"a":1}'], ok(version));
    expect(r.http.put).toHaveBeenCalledWith('/templates/4/versions/1.10.0', { changelog: 'fix', content: { a: 1 } });
    expect(r.stdout).toContain('✓ 版本已更新: 模板 #4 1.10.0');
    await expectRejected(['version', 'update', '4', '1.10.0'], '没有要修改的字段');
    await expectRejected(['version', 'update', '4', '1.10', '--changelog', 'x'], 'version 必须是 x.y.z');
    expect((await tpl(['version', 'update', '4', '1.0.0', '--changelog', 'x'], bizError(1009, 'race'))).stderr).toContain('并发冲突');
  });
});

describe('template version list / get / delete / submit', () => {
  it('list renders versions without content; empty and null cells', async () => {
    const r = await tpl(['version', 'list', '4'], ok([{ ...version, content: undefined }, { version: '1.0.0', status: 'PUBLISHED', reviewResult: null, submittedAt: null, publishedAt: '2026-09-20 10:00:00', changelog: null }]));
    expect(r.http.get).toHaveBeenCalledWith('/templates/4/versions', { params: undefined });
    expect(r.stdout).toMatch(/版本\s+状态\s+审核\s+提交\s+发布\s+变更说明/);
    expect(r.stdout).toMatch(/1\.1\.0\s+DRAFT\s+REJECTED\s+—\s+—\s+加了描述/);
    expect(r.stdout).toMatch(/1\.0\.0\s+PUBLISHED\s+—\s+—\s+2026-09-20 10:00:00\s+—/);
    expect((await tpl(['version', 'list', '4'], ok([]))).stdout).toContain('没有可见的版本');
  });

  it('get renders review outcome, dependencies and content; null fields become "—"', async () => {
    const r = await tpl(['version', 'get', '4', '1.1.0'], ok(version));
    expect(r.http.get).toHaveBeenCalledWith('/templates/4/versions/1.1.0', { params: undefined });
    expect(r.stdout).toContain('版本 1.1.0  [DRAFT]');
    expect(r.stdout).toContain('审核:     REJECTED by 900 @ 2026-09-20 11:00:00 — 缺少描述');
    expect(r.stdout).toContain('提交 —    发布 —');
    expect(r.stdout).toContain('变量: —');
    expect(r.stdout).toMatch(/#7\s+Base\s+1\.0\.0\s+requires/);
    expect((await tpl(['version', 'get', '4', '9.9.9'], bizError(1002, 'nf'))).stderr).toContain('不存在，或对你不可见');
    await expectRejected(['version', 'get', '4', 'latest'], 'version 必须是 x.y.z');
  });

  it('delete DELETEs the version; --json shape', async () => {
    const r = await tpl(['version', 'delete', '4', '1.1.0'], ok(null));
    expect(r.http.delete).toHaveBeenCalledWith('/templates/4/versions/1.1.0', undefined);
    expect(r.stdout).toContain('✓ 版本已删除: 模板 #4 1.1.0');
    expect(JSON.parse((await tpl(['version', 'delete', '4', '1.1.0', '--json'])).stdout)).toEqual({ deleted: true, id: 4, version: '1.1.0' });
  });

  it('submit POSTs .../submit and explains PUBLISHED vs REVIEWING', async () => {
    const pub = await tpl(['version', 'submit', '4', '1.1.0'], ok({ ...version, status: 'PUBLISHED' }));
    expect(pub.http.post).toHaveBeenCalledWith('/templates/4/versions/1.1.0/submit', undefined);
    expect(pub.stdout).toContain('✓ 版本 1.1.0 已发布 (PUBLISHED)');
    const rev = await tpl(['version', 'submit', '4', '1.1.0'], ok({ ...version, status: 'REVIEWING' }));
    expect(rev.stdout).toContain('已提交审核 (REVIEWING)：内容已冻结，等待平台管理员审核');
  });

  it('submit maps 1003 / 1007 / 1001 / 1009', async () => {
    const args = ['version', 'submit', '4', '1.1.0'];
    expect((await tpl(args, bizError(1003, 'x'))).stderr).toContain('商业化未开放');
    expect((await tpl(args, bizError(1007, 'x'))).stderr).toContain('已有版本在审核中');
    expect((await tpl(args, bizError(1001, 'PUBLIC 模板有不是公开模板的依赖'))).stderr).toContain('不是公开模板的依赖');
    expect((await tpl(args, bizError(1009, 'x'))).stderr).toContain('并发冲突');
  });
});

describe('template diff', () => {
  const diff = {
    from: '1.0.0', to: '1.1.0', identical: false, truncated: true,
    content: {
      added: [{ path: 'tasks[ref=c]', from: null, to: '{"ref":"c"}' }],
      changed: [{ path: 'tasks[ref=a].estimatedHours', from: '4', to: '6' }],
      removed: [{ path: 'tasks[ref=b]', from: '{"ref":"b"}', to: null }],
    },
    variables: { added: [], changed: [], removed: [] },
  };

  it('GETs .../versions/{from}/diff?to= and renders + ~ - sections', async () => {
    const r = await tpl(['diff', '4', '1.0.0', '1.1.0'], ok(diff));
    expect(r.http.get).toHaveBeenCalledWith('/templates/4/versions/1.0.0/diff', { params: { to: '1.1.0' } });
    expect(r.stdout).toContain('版本差异 1.0.0 → 1.1.0');
    expect(r.stdout).toContain('已截断');
    expect(r.stdout).toContain('内容  (+1 ~1 -1)');
    expect(r.stdout).toContain('  + tasks[ref=c]: {"ref":"c"}');
    expect(r.stdout).toContain('  ~ tasks[ref=a].estimatedHours: 4 → 6');
    expect(r.stdout).toContain('  - tasks[ref=b]: {"ref":"b"}');
    expect(r.stdout).toContain('变量: 无差异');
    expect(JSON.parse((await tpl(['diff', '4', '1.0.0', '1.1.0', '--json'], ok(diff))).stdout)).toEqual(diff);
  });

  it('identical versions and null sets render cleanly', async () => {
    const r = await tpl(['diff', '4', '1.0.0', '1.0.0'], ok({ from: '1.0.0', to: '1.0.0', identical: true, content: null, variables: null }));
    expect(r.stdout).toContain('（完全相同）');
    expect(r.stdout).toContain('内容: 无差异');
  });

  it('validates both versions and maps 1002', async () => {
    await expectRejected(['diff', '4', '1.0', '1.1.0'], 'version 必须是 x.y.z');
    await expectRejected(['diff', '4', '1.0.0', 'x'], 'to 必须是 x.y.z');
    expect((await tpl(['diff', '4', '1.0.0', '1.1.0'], bizError(1002, 'nf'))).stderr).toContain('不存在，或对你不可见');
  });
});

describe('template dependency', () => {
  const dep = { id: 1, versionId: 9, requiredTemplateId: 7, requiredTemplateName: null, minVersion: null, kind: 'optional' };

  it('set PUTs the whole list from a file (array or {dependencies})', async () => {
    const arr = write('d1.json', '[{"requiredTemplateId":7,"minVersion":"1.0.0","kind":"requires"},{"requiredTemplateId":8}]');
    const r = await tpl(['dependency', 'set', '4', '1.1.0', '--file', arr], ok([dep]));
    expect(r.http.put).toHaveBeenCalledWith('/templates/4/versions/1.1.0/dependencies', {
      dependencies: [{ requiredTemplateId: 7, minVersion: '1.0.0', kind: 'requires' }, { requiredTemplateId: 8 }],
    });
    expect(r.stdout).toContain('✓ 依赖已替换: 模板 #4 1.1.0，共 2 个');
    const wrapped = write('d2.json', '{"dependencies":[{"requiredTemplateId":7}]}');
    expect((await tpl(['dependency', 'set', '4', '1.1.0', '--file', wrapped], ok([]))).http.put).toHaveBeenCalledWith(
      '/templates/4/versions/1.1.0/dependencies', { dependencies: [{ requiredTemplateId: 7 }] });
    const empty = write('d3.json', '[]');
    expect((await tpl(['dependency', 'set', '4', '1.1.0', '--file', empty], ok([]))).http.put).toHaveBeenCalledWith(
      '/templates/4/versions/1.1.0/dependencies', { dependencies: [] });
  });

  it('set validates the file: shape, ids, kind, versions, unknown keys, duplicates, >20, bombs', async () => {
    const run = (name: string, text: string) => ['dependency', 'set', '4', '1.1.0', '--file', write(name, text)];
    await expectRejected(run('e1.json', '{"x":1}'), '数组，或形如');
    await expectRejected(run('e2.json', '[1]'), 'dependencies[0]: 必须是对象');
    await expectRejected(run('e3.json', '[{"minVersion":"1.0.0"}]'), 'dependencies[0].requiredTemplateId 必须是正整数');
    await expectRejected(run('e4.json', '[{"requiredTemplateId":7,"kind":"hard"}]'), 'dependencies[0].kind 取值无效');
    await expectRejected(run('e5.json', '[{"requiredTemplateId":7,"minVersion":"1.0"}]'), 'dependencies[0].minVersion 必须是 x.y.z');
    await expectRejected(run('e6.json', '[{"requiredTemplateId":7,"extra":1}]'), '不支持的字段 extra');
    await expectRejected(run('e7.json', '[{"requiredTemplateId":7},{"requiredTemplateId":7}]'), 'requiredTemplateId 不能重复');
    await expectRejected(run('e8.json', JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ requiredTemplateId: i + 1 })))), '最多 20 个');
    await expectRejected(run('e9.json', '['.repeat(1000) + ']'.repeat(1000)), '嵌套超过 32 层');
    await expectRejected(['dependency', 'set', '4', '1.1.0', '--file', path.join(dir, 'none.json')], '无法读取');
  });

  it('add POSTs one dependency; kind is case-insensitive; validation first', async () => {
    const r = await tpl(['dependency', 'add', '4', '1.1.0', '--template', '7', '--min-version', '1.2.0', '--kind', 'Optional'], ok([dep]));
    expect(r.http.post).toHaveBeenCalledWith('/templates/4/versions/1.1.0/dependencies', { requiredTemplateId: 7, minVersion: '1.2.0', kind: 'optional' });
    expect(r.stdout).toContain('✓ 依赖已添加: 模板 #4 1.1.0 → #7');
    await expectRejected(['dependency', 'add', '4', '1.1.0', '--template', 'x'], '--template 必须是正整数');
    await expectRejected(['dependency', 'add', '4', '1.1.0', '--template', '7', '--kind', 'soft'], '--kind 取值无效');
    await expectRejected(['dependency', 'add', '4', '1.1.0', '--template', '7', '--min-version', '2'], '--min-version 必须是 x.y.z');
    expect((await tpl(['dependency', 'add', '4', '1.1.0', '--template', '7'], bizError(1001, '依赖会形成环'))).stderr).toContain('依赖会形成环');
    expect((await tpl(['dependency', 'add', '4', '1.1.0', '--template', '7'], bizError(1006, 'dup'))).stderr).toContain('依赖或包条目重复');
  });

  it('list renders the table with "—" for hidden names / null min version; rm DELETEs by id', async () => {
    const r = await tpl(['dependency', 'list', '4', '1.1.0'], ok([dep]));
    expect(r.http.get).toHaveBeenCalledWith('/templates/4/versions/1.1.0/dependencies', { params: undefined });
    expect(r.stdout).toMatch(/1\s+#7\s+—\s+—\s+optional/);
    expect((await tpl(['dependency', 'list', '4', '1.1.0'], ok([]))).stdout).toContain('依赖: —');
    const rm = await tpl(['dependency', 'rm', '4', '1.1.0', '1'], ok(null));
    expect(rm.http.delete).toHaveBeenCalledWith('/templates/4/versions/1.1.0/dependencies/1', undefined);
    expect(rm.stdout).toContain('✓ 依赖已删除: #1');
    await expectRejected(['dependency', 'rm', '4', '1.1.0', '0'], 'dependencyId 必须是正整数');
  });
});
