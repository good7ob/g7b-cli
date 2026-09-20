import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { registerTemplateCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const tpl = (args: string[], response = ok(null)) => runCli(registerTemplateCommands, ['template', ...args], response as never);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-upg-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await tpl(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

const REQUEST = { timeout: 120_000 };
const PKG = ['package', 'use', '5', '--org', '3', '--product', '9'];

const packageResult = {
  packageId: 5, packageName: 'Web 起步包', createdObjectCount: 3, warnings: ['可选依赖 X 未安装'],
  instances: [
    { id: 31, templateId: 4, templateName: '登录', templateType: 'TASK', version: '1.0.0', createdObjectType: 'TASK_BATCH', createdObjectId: 55, createdObjects: [{ type: 'TASK', id: 1 }, { type: 'TASK', id: 2 }] },
    { id: 32, templateId: 9, templateName: null, templateType: 'API', version: '1.0.0', createdObjectType: 'DOCUMENT', createdObjects: [] },
  ],
};

describe('template package use', () => {
  it('POSTs shared variables, per-item overrides, target options and installDependencies to the package endpoint', async () => {
    const r = await tpl([...PKG, '--module', '55', '--suite', '12', '--start', '2026-10-01', '--end', '2026-10-31',
      '--var', 'project_name=商城', '--item', '4:feature=登录', '--item', '9:lang=zh', '--item', '4:owner=张三', '--with-deps'], ok(packageResult));
    expect(r.http.post).toHaveBeenCalledWith('/templates/packages/5/instantiate', {
      orgId: 3, productId: 9, moduleId: 55, suiteId: 12, plannedStartDate: '2026-10-01', plannedEndDate: '2026-10-31',
      installDependencies: true, variables: { project_name: '商城' },
      items: [{ templateId: 4, variables: { feature: '登录', owner: '张三' } }, { templateId: 9, variables: { lang: 'zh' } }],
    }, REQUEST);
    expect(r.stdout).toContain('✓ 已实例化模板包 #5 Web 起步包: 2 个实例，共创建 3 个对象（整包一个事务）');
    expect(r.stdout).toMatch(/#31\s+#4 登录\s+TASK\s+1\.0\.0\s+TASK_BATCH #55\s+2/);
    expect(r.stdout).toMatch(/#32\s+#9 —\s+API\s+1\.0\.0\s+DOCUMENT\s+0/);
    expect(r.stdout).toContain('⚠ 可选依赖 X 未安装');
  });

  it('sends only what was given and reads --vars-file', async () => {
    const bare = await tpl(PKG, ok(packageResult));
    expect(bare.http.post).toHaveBeenCalledWith('/templates/packages/5/instantiate', { orgId: 3, productId: 9 }, REQUEST);
    const file = path.join(dir, 'shared.json');
    fs.writeFileSync(file, '{"project_name":"商城","n":3}');
    const r = await tpl([...PKG, '--vars-file', file], ok(packageResult));
    expect(r.http.post.mock.calls[0][1]).toEqual({ orgId: 3, productId: 9, variables: { project_name: '商城', n: 3 } });
  });

  it('--json prints the raw result; a sparse result renders "—"', async () => {
    expect(JSON.parse((await tpl([...PKG, '--json'], ok(packageResult))).stdout).createdObjectCount).toBe(3);
    const r = await tpl(PKG, ok({}));
    expect(r.stdout).toContain('模板包 #— —: 0 个实例，共创建 — 个对象');
    expect(r.stdout).not.toMatch(/undefined|null/);
  });

  it('validates at the boundary: nothing is sent', async () => {
    await expectRejected(['package', 'use', 'x', '--org', '3', '--product', '9'], 'packageId 必须是正整数');
    await expectRejected([...PKG, '--org', '0'], '--org 必须是正整数');
    await expectRejected([...PKG, '--item', 'nocolon'], '--item 必须是 <templateId>:<name>=<value>');
    await expectRejected([...PKG, '--item', 'x:a=1'], '--item 的 templateId 必须是正整数');
    await expectRejected([...PKG, '--item', '4:a'], '--item 必须是 name=value');
    await expectRejected([...PKG, '--item', '4:a=1', '--item', '4:a=2'], '变量 a 重复');
    await expectRejected([...PKG, '--item', `4:a=${'x'.repeat(5001)}`], '值最多 5000');
    await expectRejected([...PKG, '--item', ...Array.from({ length: 21 }, (_, i) => `${i + 1}:a=1`).flatMap((v) => [v, '--item']).slice(0, -1)], '最多覆盖 20 个模板');
    await expectRejected([...PKG, '--var', 'a=1', '--vars-file', 'x.json'], '不能同时使用');
    await expectRejected([...PKG, '--start', '2026-10-31', '--end', '2026-10-01'], '不能早于 --start');
  });

  it('maps the package failure codes and warns on timeout', async () => {
    expect((await tpl(PKG, bizError(1007, '第 2 项（登录）：缺必需依赖'))).stderr).toContain('第 2 项（登录）：缺必需依赖');
    expect((await tpl(PKG, bizError(1001, '共享变量 zzz 没有条目定义'))).stderr).toContain('变量缺失 / 未知');
    expect((await tpl(PKG, bizError(2000, 'no'))).stderr).toContain('你不是目标组织的活跃成员');
    const timeout = await runCli(registerTemplateCommands, ['template', ...PKG], () => { throw new Error('timeout of 120000ms exceeded'); });
    expect(timeout.stderr).toContain('服务端可能已执行，请先用 template instances 核对，勿盲目重试');
  });

  it('does not disturb the existing package subcommands', async () => {
    const r = await tpl(['package', 'get', '5'], ok({ id: 5, name: 'P', items: [] }));
    expect(r.http.get).toHaveBeenCalledWith('/templates/packages/5', { params: undefined });
  });
});

describe('template upgrade', () => {
  const check = {
    instanceId: 31, templateId: 4, templateName: '登录功能开发', currentVersion: '1.0.0', latestVersion: '1.1.0', upgradeAvailable: true,
    note: '已有实例与它创建的业务对象不会被自动修改；如需使用新版本，请用新版本重新实例化',
    diff: {
      from: '1.0.0', to: '1.1.0', identical: false, truncated: false,
      content: { added: [{ path: 'tasks[2]', to: '测试' }], changed: [{ path: 'tasks[0].name', from: '设计', to: '设计评审' }], removed: [{ path: 'tasks[1].description', from: '旧描述' }] },
      variables: { added: [{ path: 'owner', to: 'string' }], changed: [], removed: [] },
    },
  };

  it('GETs the upgrade check and shows versions, the diff and the never-modified note', async () => {
    const r = await tpl(['upgrade', '31'], ok(check));
    expect(r.http.get).toHaveBeenCalledWith('/templates/instances/31/upgrade', { params: undefined });
    expect(r.http.post).not.toHaveBeenCalled();
    expect(r.stdout).toContain('实例 #31  模板 #4 登录功能开发  当前 v1.0.0  最新已发布 v1.1.0');
    expect(r.stdout).toContain('✓ 有新版本可用');
    expect(r.stdout).toContain('版本差异 1.0.0 → 1.1.0');
    expect(r.stdout).toContain('+ tasks[2]: 测试');
    expect(r.stdout).toContain('~ tasks[0].name: 设计 → 设计评审');
    expect(r.stdout).toContain('- tasks[1].description: 旧描述');
    expect(r.stdout).toContain('注意: 已有实例与它创建的业务对象不会被自动修改');
    expect(r.stdout).toContain('template upgrade 31 --preview');
  });

  it('no upgrade: shows the reason; the note falls back to the built-in text; null fields are "—"', async () => {
    const r = await tpl(['upgrade', '31'], ok({ instanceId: 31, templateId: 4, currentVersion: '1.0.0', latestVersion: null, upgradeAvailable: false, reason: '模板已下架', diff: null }));
    expect(r.stdout).toContain('最新已发布 —');
    expect(r.stdout).toContain('✗ 没有可升级的版本：模板已下架');
    expect(r.stdout).toContain('注意: 已有实例与它创建的业务对象不会被自动修改');
    expect(r.stdout).not.toMatch(/undefined|null/);
    expect(JSON.parse((await tpl(['upgrade', '31', '--json'], ok(check))).stdout).latestVersion).toBe('1.1.0');
  });

  it('maps 1002 (someone else\'s instance) and validates the id', async () => {
    expect((await tpl(['upgrade', '31'], bizError(1002, 'nf'))).stderr).toContain('不存在或对你不可见');
    await expectRejected(['upgrade', 'abc'], 'instanceId 必须是正整数');
  });

  it('--version / --var / --vars-file / --out / --force are refused without --preview', async () => {
    for (const extra of [['--version', '1.1.0'], ['--var', 'a=1'], ['--vars-file', 'x.json'], ['--out', 'x.md'], ['--force']]) {
      await expectRejected(['upgrade', '31', ...extra], '需要与 --preview 一起使用');
    }
  });

  const preview = { instanceId: 31, from: '1.0.0', to: '1.1.0', variables: { feature: '登录', owner: '张三' }, renderedContent: { tasks: [{ name: '登录：设计评审' }] } };

  it('--preview POSTs version + variables, renders the result and says nothing was created', async () => {
    const r = await tpl(['upgrade', '31', '--preview', '--version', '1.1.0', '--var', 'owner=张三'], ok(preview));
    expect(r.http.post).toHaveBeenCalledWith('/templates/instances/31/upgrade-preview', { version: '1.1.0', variables: { owner: '张三' } });
    expect(r.http.get).not.toHaveBeenCalled();
    expect(r.stdout).toContain('升级预览: 实例 #31  v1.0.0 → v1.1.0（仅渲染，未创建任何对象，未修改实例）');
    expect(r.stdout).toMatch(/owner\s+张三/);
    expect(r.stdout).toContain('"name": "登录：设计评审"');
    expect(r.stdout).toContain('good7ob template use <templateId> --version 1.1.0');
  });

  it('--preview with nothing else posts an empty body (server: latest version, saved variables)', async () => {
    const r = await tpl(['upgrade', '31', '--preview'], ok({ ...preview, variables: null }));
    expect(r.http.post).toHaveBeenCalledWith('/templates/instances/31/upgrade-preview', {});
    expect(r.stdout).toContain('变量: —');
  });

  it('--preview validates version and variables first; a new required variable comes back as 1001', async () => {
    await expectRejected(['upgrade', '31', '--preview', '--version', '1.1'], '--version 必须是 x.y.z');
    await expectRejected(['upgrade', '31', '--preview', '--var', 'bad'], '--var 必须是 name=value');
    await expectRejected(['upgrade', '31', '--preview', '--var', 'a=1', '--vars-file', 'x.json'], '不能同时使用');
    const r = await tpl(['upgrade', '31', '--preview'], bizError(1001, 'variables: 缺少必填变量: owner'));
    expect(r.stderr).toContain('缺少必填变量: owner');
  });

  it('--preview --out writes a document body, refuses overwrite without --force, and never touches the server first', async () => {
    const file = path.join(dir, 'upg.md');
    const doc = { ...preview, renderedContent: { format: 'markdown', body: '# 新版' } };
    const r = await tpl(['upgrade', '31', '--preview', '--out', file], ok(doc));
    expect(fs.readFileSync(file, 'utf-8')).toBe('# 新版\n');
    expect(r.stdout).toContain(`✓ 渲染结果已写入 ${file}`);
    const again = await tpl(['upgrade', '31', '--preview', '--out', file], ok(doc));
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain('已存在，不会覆盖');
    expect(noHttpCalls(again)).toBe(true);
    const forced = await tpl(['upgrade', '31', '--preview', '--out', file, '--force'], ok({ ...doc, renderedContent: { format: 'markdown', body: '# 更新' } }));
    expect(forced.exitCode).toBeUndefined();
    expect(fs.readFileSync(file, 'utf-8')).toBe('# 更新\n');
  });
});
