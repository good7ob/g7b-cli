import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { registerTemplateCommands } from '../index';
import { emitWithOut, writeOutFile } from '../outFile';
import { renderInstantiated } from '../renderUse';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const tpl = (args: string[], response = ok(null)) => runCli(registerTemplateCommands, ['template', ...args], response as never);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-use-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);

async function expectRejected(args: string[], needle: string) {
  const r = await tpl(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const page = (records: unknown[], total = records.length) => ({ records, total, current: 1, size: 20, pages: 1 });
const USE = ['use', '4', '--org', '3', '--product', '9'];
const REQUEST = { timeout: 120_000 };

const taskInstance = {
  id: 31, templateId: 4, templateName: '登录功能开发', templateType: 'TASK', version: '1.0.0', orgId: 3, productId: 9,
  createdObjectType: 'TASK_BATCH', createdObjectId: 55, status: 'COMPLETED', createdBy: 13, createdAt: '2026-09-20 10:00:00',
  createdObjects: [{ type: 'TASK', id: 901, name: '登录：设计', ref: 'a' }, { type: 'TASK', id: 902, name: '登录：开发', ref: null }],
  warnings: ['可选依赖 AWS 部署 Skill 未安装'], renderedContent: { tasks: [{ name: '登录：设计' }] },
};
const docBody = `# 登录接口\n\n${ESC}[31mred${ESC}[0m 正文`;
const docInstance = {
  id: 32, templateId: 8, templateName: '接口文档', templateType: 'API', version: '2.0.0', orgId: 3, productId: 9,
  createdObjectType: 'DOCUMENT', createdObjectId: null, createdObjects: [], status: 'COMPLETED',
  renderedContent: { format: 'markdown', body: docBody },
};

describe('template install / uninstall / installed', () => {
  it('install POSTs org, version and installDependencies; nothing else', async () => {
    const r = await tpl(['install', '4', '--org', '3', '--version', '1.0.0', '--with-deps'], ok({
      id: 7, templateId: 4, templateName: '登录功能开发', orgId: 3, version: '1.0.0', publishedVersion: '1.1.0', upgradeAvailable: true, created: true,
      dependencies: { templateId: 4, version: '1.0.0', satisfied: true, missingRequired: 0, items: [], warnings: [] },
    }));
    expect(r.http.post).toHaveBeenCalledWith('/templates/4/install', { orgId: 3, version: '1.0.0', installDependencies: true });
    expect(r.stdout).toContain('✓ 已安装: 模板 #4 登录功能开发 v1.0.0  组织 #3');
    expect(r.stdout).toContain('有新版本 1.1.0 可用');
  });

  it('install with no flags is personal scope, and an unchanged re-install says so', async () => {
    const r = await tpl(['install', '4'], ok({ id: 7, templateId: 4, version: '1.0.0', orgId: null, created: false }));
    expect(r.http.post).toHaveBeenCalledWith('/templates/4/install', {});
    expect(r.stdout).toContain('已是安装状态（未变化）: 模板 #4 v1.0.0  个人范围');
    expect(JSON.parse((await tpl(['install', '4', '--json'], ok({ id: 7 }))).stdout)).toEqual({ id: 7 });
  });

  it('install validates ids and versions before any request', async () => {
    await expectRejected(['install', 'abc'], 'id 必须是正整数');
    await expectRejected(['install', '4', '--org', '0'], '--org 必须是正整数');
    await expectRejected(['install', '4', '--version', '1.0'], '--version 必须是 x.y.z');
  });

  it('install maps 1007 / 2000 / 1002', async () => {
    expect((await tpl(['install', '4'], bizError(1007, '已下架'))).stderr).toContain('当前状态不允许：模板未发布');
    expect((await tpl(['install', '4', '--org', '3'], bizError(2000, 'no'))).stderr).toContain('你不是目标组织的活跃成员');
    expect((await tpl(['install', '4'], bizError(1002, 'nf'))).stderr).toContain('不存在或对你不可见');
  });

  it('uninstall DELETEs with the org in the query string and reports removed / not installed', async () => {
    const r = await tpl(['uninstall', '4', '--org', '3'], ok({ templateId: 4, orgId: 3, installed: false, removed: true }));
    expect(r.http.delete).toHaveBeenCalledWith('/templates/4/install?orgId=3', undefined);
    expect(r.stdout).toContain('✓ 已卸载模板 #4（组织 #3）；已有实例保留');
    const none = await tpl(['uninstall', '4'], ok({ templateId: 4, orgId: null, installed: false, removed: false }));
    expect(none.http.delete).toHaveBeenCalledWith('/templates/4/install', undefined);
    expect(none.stdout).toContain('本来就没有安装（未变化）');
    await expectRejected(['uninstall', '4', '--org', 'x'], '--org 必须是正整数');
  });

  it('installed lists with paging + org; unavailable templates and null fields render "—"', async () => {
    const rows = [
      { id: 7, templateId: 4, templateName: '登录功能开发', templateType: 'TASK', orgId: 3, version: '1.0.0', publishedVersion: '1.1.0', upgradeAvailable: true, installedAt: '2026-09-20 10:00:00' },
      { id: 8, templateId: 9, templateName: null, templateType: null, templateStatus: 'UNAVAILABLE', orgId: null, version: '1.0.0', publishedVersion: null, upgradeAvailable: false, installedAt: null },
    ];
    const r = await tpl(['installed', '--org', '3', '-p', '2', '--page-size', '10'], ok(page(rows, 25)));
    expect(r.http.get).toHaveBeenCalledWith('/templates/installed', { params: { pageNum: 2, pageSize: 10, orgId: 3 } });
    expect(r.stdout).toMatch(/7\s+#4 登录功能开发\s+TASK\s+组织 #3\s+1\.0\.0\s+1\.1\.0\s+是\s+2026-09-20 10:00:00/);
    expect(r.stdout).toMatch(/8\s+#9 （已不可见）\s+—\s+个人\s+1\.0\.0\s+—\s+否\s+—/);
    expect(r.stdout).toContain('共 25 条，第 2/3 页');
    expect((await tpl(['installed'], ok(page([])))).stdout).toContain('还没有安装任何模板');
    await expectRejected(['installed', '--page-size', '51'], '--page-size');
  });
});

describe('template deps', () => {
  const check = {
    templateId: 4, version: '1.0.0', satisfied: false, missingRequired: 1, warnings: ['可选依赖 AWS 部署 Skill 未安装'],
    items: [
      { templateId: 7, templateName: 'SaaS PRD 模板', kind: 'requires', minVersion: '2.0.0', installedVersion: null, publishedVersion: '2.1.0', status: 'MISSING', installable: true, depth: 1, requiredBy: 4 },
      { templateId: 8, templateName: null, kind: 'optional', minVersion: null, installedVersion: '1.0.0', publishedVersion: null, status: 'UNAVAILABLE', installable: false, depth: 2, requiredBy: 7 },
    ],
  };

  it('GETs the check with org and version and renders status / installable / requiredBy', async () => {
    const r = await tpl(['deps', '4', '--org', '3', '--version', '1.0.0'], ok(check));
    expect(r.http.get).toHaveBeenCalledWith('/templates/4/dependencies/check', { params: { orgId: 3, version: '1.0.0' } });
    expect(r.stdout).toContain('依赖检查: 模板 #4 v1.0.0  ✗ 缺少 1 个必需依赖');
    expect(r.stdout).toMatch(/#7 SaaS PRD 模板\s+requires\s+2\.0\.0\s+—\s+2\.1\.0\s+缺失\s+是\s+1\s+#4/);
    expect(r.stdout).toMatch(/#8 —\s+optional\s+—\s+1\.0\.0\s+—\s+不可用\s+否\s+2\s+#7/);
    expect(r.stdout).toContain('⚠ 可选依赖 AWS 部署 Skill 未安装');
  });

  it('satisfied / no dependencies, --json, and validation', async () => {
    const r = await tpl(['deps', '4'], ok({ templateId: 4, version: '1.0.0', satisfied: true, missingRequired: 0, items: [], warnings: [] }));
    expect(r.http.get).toHaveBeenCalledWith('/templates/4/dependencies/check', { params: {} });
    expect(r.stdout).toContain('✓ 必需依赖全部满足');
    expect(r.stdout).toContain('（没有依赖）');
    expect(JSON.parse((await tpl(['deps', '4', '--json'], ok(check))).stdout).missingRequired).toBe(1);
    await expectRejected(['deps', '4', '--version', 'latest'], '--version 必须是 x.y.z');
    expect((await tpl(['deps', '4', '--org', '3'], bizError(2000, 'no'))).stderr).toContain('你不是目标组织的活跃成员');
  });
});

describe('template instances / instance', () => {
  it('instances GETs with every filter, upper-cases the type, and renders "—" for missing parts', async () => {
    const rows = [
      { ...taskInstance, renderedContent: undefined },
      { id: 33, templateId: 9, templateName: null, templateType: 'API', version: null, orgId: null, productId: 9, createdObjectType: 'DOCUMENT', createdObjectId: null, status: 'COMPLETED', packageId: 5, createdAt: null },
    ];
    const r = await tpl(['instances', '--template', '4', '--type', 'task', '--org', '3', '--product', '9', '--package', '5', '-p', '2', '--page-size', '5'], ok(page(rows, 7)));
    expect(r.http.get).toHaveBeenCalledWith('/templates/instances', { params: { pageNum: 2, pageSize: 5, templateId: 4, type: 'TASK', orgId: 3, productId: 9, packageId: 5 } });
    expect(r.stdout).toMatch(/31\s+COMPLETED\s+TASK\s+#4 登录功能开发\s+1\.0\.0\s+3\s+9\s+TASK_BATCH #55\s+—\s+2026-09-20 10:00:00/);
    expect(r.stdout).toMatch(/33\s+COMPLETED\s+API\s+#9 —\s+—\s+—\s+9\s+DOCUMENT\s+5\s+—/);
    expect(r.stdout).toContain('共 7 条，第 2/2 页');
    expect((await tpl(['instances'], ok(page([])))).stdout).toContain('还没有实例');
    expect((await tpl(['instances'])).http.get).toHaveBeenCalledWith('/templates/instances', { params: { pageNum: 1, pageSize: 20 } });
    await expectRejected(['instances', '--type', 'BOGUS'], '--type 取值无效');
    await expectRejected(['instances', '--template', '0'], '--template 必须是正整数');
    await expectRejected(['instances', '--package', 'x'], '--package 必须是正整数');
  });

  it('instance renders variables, created objects and a structured result (head only)', async () => {
    const r = await tpl(['instance', '31'], ok({ ...taskInstance, variables: { feature: '登录', hours: 8 } }));
    expect(r.http.get).toHaveBeenCalledWith('/templates/instances/31', { params: undefined });
    expect(r.stdout).toContain('实例 #31 [COMPLETED]  模板 #4 登录功能开发 (TASK v1.0.0)');
    expect(r.stdout).toMatch(/feature\s+登录/);
    expect(r.stdout).toMatch(/TASK\s+901\s+登录：设计\s+a/);
    expect(r.stdout).toMatch(/TASK\s+902\s+登录：开发\s+—/);
    expect(r.stdout).toContain('渲染结果:');
    expect((await tpl(['instance', '31'], bizError(1002, 'x'))).stderr).toContain('不存在或对你不可见');
    await expectRejected(['instance', 'abc'], 'id 必须是正整数');
  });

  it('a document instance prints its body with terminal escapes stripped (untrusted text)', async () => {
    const r = await tpl(['instance', '32'], ok(docInstance));
    expect(r.stdout).toContain('渲染结果 (markdown):');
    expect(r.stdout).toContain('# 登录接口');
    expect(r.stdout).toContain('red 正文');
    expect(r.stdout).not.toContain(ESC);
    expect(r.stdout).toContain('创建的对象: —');
  });
});

describe('template use', () => {
  it('POSTs orgId / productId / options / variables with the long instantiate timeout and renders created objects', async () => {
    const r = await tpl([...USE, '--module', '55', '--version', '1.0.0', '--var', 'feature=登录', '--var', 'note=a=b', '--with-deps'], ok(taskInstance));
    expect(r.http.post).toHaveBeenCalledWith('/templates/4/instantiate', {
      orgId: 3, productId: 9, moduleId: 55, version: '1.0.0', variables: { feature: '登录', note: 'a=b' }, installDependencies: true,
    }, REQUEST);
    expect(r.stdout).toContain('✓ 已实例化: 实例 #31 [COMPLETED]  模板 #4 登录功能开发 (TASK v1.0.0)');
    expect(r.stdout).toContain('产出: TASK_BATCH #55');
    expect(r.stdout).toMatch(/TASK\s+901\s+登录：设计\s+a/);
    expect(r.stdout).toMatch(/TASK\s+902\s+登录：开发\s+—/);
    expect(r.stdout).toContain('⚠ 可选依赖 AWS 部署 Skill 未安装');
  });

  it('sends only what was given (RELEASE dates, TEST suite)', async () => {
    const r = await tpl([...USE, '--start', '2026-10-01', '--end', '2026-10-31', '--suite', '12'], ok(taskInstance));
    expect(r.http.post).toHaveBeenCalledWith('/templates/4/instantiate', {
      orgId: 3, productId: 9, suiteId: 12, plannedStartDate: '2026-10-01', plannedEndDate: '2026-10-31',
    }, REQUEST);
  });

  it('reads variables from --vars-file (numbers and booleans keep their JSON type)', async () => {
    const file = path.join(dir, 'vars.json');
    fs.writeFileSync(file, JSON.stringify({ feature: '登录', hours: 8, urgent: true, extra: null }));
    const r = await tpl([...USE, '--vars-file', file], ok(taskInstance));
    expect(r.http.post.mock.calls[0][1]).toMatchObject({ variables: { feature: '登录', hours: 8, urgent: true, extra: null } });
  });

  it('a document result is printed in full; --json prints the raw instance', async () => {
    const r = await tpl(['use', '8', '--org', '3', '--product', '9'], ok(docInstance));
    expect(r.stdout).toContain('渲染结果 (markdown):');
    expect(r.stdout).toContain('# 登录接口');
    expect(JSON.parse((await tpl([...USE, '--json'], ok(taskInstance))).stdout).id).toBe(31);
  });

  it('every response field is optional: a sparse instance renders "—", never "undefined" / "null"', async () => {
    const r = await tpl(USE, ok({ id: 40 }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('实例 #40 [—]  模板 #— — (— v—)');
    expect(r.stdout).toContain('创建的对象: —');
    expect(r.stdout).not.toMatch(/undefined|null/);
  });

  it('validates flags at the boundary: nothing is sent', async () => {
    await expectRejected(['use', 'abc', '--org', '3', '--product', '9'], 'id 必须是正整数');
    await expectRejected([...USE, '--org', '3x'], '--org 必须是正整数');
    await expectRejected([...USE, '--module', '0'], '--module 必须是正整数');
    await expectRejected([...USE, '--suite', '-1'], '--suite 必须是正整数');
    await expectRejected([...USE, '--version', '1.0'], '--version 必须是 x.y.z');
    await expectRejected([...USE, '--start', '2026-02-30'], '--start 必须是 yyyy-MM-dd');
    await expectRejected([...USE, '--end', '10/31/2026'], '--end 必须是 yyyy-MM-dd');
    await expectRejected([...USE, '--start', '2026-10-31', '--end', '2026-10-01'], '不能早于 --start');
    await expectRejected([...USE, '--var', 'novalue'], '--var 必须是 name=value');
    await expectRejected([...USE, '--var', '=v'], '--var 必须是 name=value');
    await expectRejected([...USE, '--var', '1bad=v'], '不是合法的变量名');
    await expectRejected([...USE, '--var', 'a=1', '--var', 'a=2'], '变量 a 重复');
    await expectRejected([...USE, '--var', `a=${'x'.repeat(5001)}`], '值最多 5000');
    await expectRejected([...USE, '--var', `a=x${NUL}y`], 'NUL');
    await expectRejected([...USE, ...Array.from({ length: 51 }, (_, i) => ['--var', `v${i}=1`]).flat()], '最多 50 个变量');
    await expectRejected([...USE, '--var', 'a=1', '--vars-file', 'x.json'], '不能同时使用');
    await expectRejected([...USE, '--force'], '--force 只能与 --out 一起使用');
  });

  it('a missing --org / --product is a usage error, not a request', async () => {
    const r = await tpl(['use', '4', '--org', '3']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--product');
    expect(noHttpCalls(r)).toBe(true);
  });

  it('maps the business codes with T2 wording', async () => {
    const codes: Array<[number, string]> = [
      [1000, 'TASK 类型必须带 --module'], [1001, '变量缺失 / 未知 / 类型不符'], [1002, '产品不存在 / 不属于该组织'],
      [1003, '商业化未开放'], [1006, 'RELEASE 渲染出的版本号'], [1007, '缺必需依赖（可加 --with-deps）'], [2000, '你不是目标组织的活跃成员'],
    ];
    for (const [code, needle] of codes) {
      const r = await tpl(USE, bizError(code, 'server says no'));
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain(needle);
      expect(r.stderr).toContain('server says no');
      expect(r.stderr).not.toContain('服务端可能已执行');
    }
  });

  it('a client timeout warns that the server may have executed; a 502 does too; a business error does not', async () => {
    const timeout = await runCli(registerTemplateCommands, ['template', ...USE], () => { throw new Error('timeout of 120000ms exceeded'); });
    expect(timeout.exitCode).toBe(1);
    expect(timeout.stderr).toContain('服务端可能已执行，请先用 template instances 核对，勿盲目重试');
    const gateway = await runCli(registerTemplateCommands, ['template', ...USE], () => { throw new Error('Request failed with status code 502'); });
    expect(gateway.stderr).toContain('服务端可能已执行');
  });
});

describe('template use --out', () => {
  it('writes the document body (not the terminal-sanitised text) and points to the file', async () => {
    const file = path.join(dir, 'doc.md');
    const r = await tpl(['use', '8', '--org', '3', '--product', '9', '--out', file], ok(docInstance));
    expect(fs.readFileSync(file, 'utf-8')).toBe(`${docBody}\n`);
    expect(r.stdout).toContain(`✓ 渲染结果已写入 ${file}`);
    expect(r.stdout).not.toContain('# 登录接口');
  });

  it('a structured result is written as pretty JSON', async () => {
    const file = path.join(dir, 'tasks.json');
    await tpl([...USE, '--out', file], ok(taskInstance));
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual(taskInstance.renderedContent);
  });

  it('refuses an existing file BEFORE the request, overwrites only with --force', async () => {
    const file = path.join(dir, 'exists.md');
    fs.writeFileSync(file, 'keep me');
    const refused = await tpl([...USE, '--out', file], ok(docInstance));
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain('已存在，不会覆盖');
    expect(noHttpCalls(refused)).toBe(true);
    expect(fs.readFileSync(file, 'utf-8')).toBe('keep me');
    const forced = await tpl(['use', '8', '--org', '3', '--product', '9', '--out', file, '--force'], ok(docInstance));
    expect(forced.exitCode).toBeUndefined();
    expect(fs.readFileSync(file, 'utf-8')).toContain('# 登录接口');
  });

  it('refuses directories, symlinks (even with --force), missing parent directories, and an empty path', async () => {
    const target = path.join(dir, 'target.md');
    fs.writeFileSync(target, 'original');
    const link = path.join(dir, 'link.md');
    fs.symlinkSync(target, link);
    await expectRejected([...USE, '--out', dir], '必须是普通文件路径');
    await expectRejected([...USE, '--out', link, '--force'], '不能是符号链接');
    await expectRejected([...USE, '--out', path.join(dir, 'nope', 'x.md')], '--out 的目录不存在');
    await expectRejected([...USE, '--out', ' '], '--out 不能为空');
    expect(fs.readFileSync(target, 'utf-8')).toBe('original');
  });

  it('a write that fails after the server acted still prints the result, then exits 1 naming the instance', async () => {
    const gone = path.join(dir, 'vanished', 'x.md'); // passes no pre-check here: emitWithOut is called directly
    const r = await runCli((program) => program.command('probe').action(() => {
      emitWithOut(false, taskInstance, (w) => renderInstantiated(taskInstance, w), { file: gone, content: taskInstance.renderedContent, failPrefix: '实例 #31 已创建，但写入文件失败' });
    }), ['probe']);
    expect(r.stdout).toContain('✓ 已实例化: 实例 #31');
    expect(r.stderr).toContain('实例 #31 已创建，但写入文件失败');
    expect(r.exitCode).toBe(1);
  });

  it('the write itself is exclusive: a file that appeared after the pre-check is never touched, a symlink is refused even when forced', () => {
    const raced = path.join(dir, 'raced.md');
    fs.writeFileSync(raced, 'raced');
    expect(() => writeOutFile(raced, 'new')).toThrow(/EEXIST/);
    expect(fs.readFileSync(raced, 'utf-8')).toBe('raced');
    const link = path.join(dir, 'link2.md');
    fs.symlinkSync(raced, link);
    expect(() => writeOutFile(link, 'new', true)).toThrow();
    expect(fs.readFileSync(raced, 'utf-8')).toBe('raced');
    writeOutFile(raced, 'forced', true);
    expect(fs.readFileSync(raced, 'utf-8')).toBe('forced\n');
  });

  it('instance --out follows the same rules', async () => {
    const file = path.join(dir, 'inst.md');
    const r = await tpl(['instance', '32', '--out', file], ok(docInstance));
    expect(fs.readFileSync(file, 'utf-8')).toContain('# 登录接口');
    expect(r.stdout).toContain(`✓ 渲染结果已写入 ${file}`);
    const again = await tpl(['instance', '32', '--out', file], ok(docInstance));
    expect(again.exitCode).toBe(1);
    expect(noHttpCalls(again)).toBe(true);
  });
});
