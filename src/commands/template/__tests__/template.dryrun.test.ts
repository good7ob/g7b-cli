import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { registerTemplateCommands } from '../index';
import { Envelope, bizError, ok, runCli } from '../../../utils/__tests__/cliHarness';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-dry-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

const version = {
  id: 4, templateId: 4, version: '1.0.0', status: 'PUBLISHED',
  variables: [
    { name: 'feature', label: '功能', type: 'string', required: true },
    { name: 'hours', label: '工时', type: 'number', required: false, default: '8' },
    { name: 'level', label: '级别', type: 'enum', options: ['low', 'high'], required: false, default: 'low' },
    { name: 'due', label: '截止', type: 'date', required: false },
  ],
  content: { tasks: [
    { name: '{{feature}}：设计', description: '工时 {{ hours }}，级别 {{level}}，截止 {{due}}', ref: 'a' },
    { name: '{{feature}}：开发', dependsOn: ['a'] },
  ] },
};
const detail = { id: 4, name: '登录功能开发', templateType: 'TASK', status: 'PUBLISHED', publishedVersion: '1.0.0', version };
const depsOk = { templateId: 4, version: '1.0.0', satisfied: true, missingRequired: 0, items: [], warnings: [] };
const depsMissing = {
  templateId: 4, version: '1.0.0', satisfied: false, missingRequired: 1, warnings: [],
  items: [{ templateId: 7, templateName: 'SaaS PRD 模板', kind: 'requires', minVersion: '2.0.0', status: 'MISSING', installable: true, depth: 1, requiredBy: 4 }],
};

interface World { detail?: unknown; version?: unknown; deps?: unknown; failDeps?: Envelope }

const world = (w: World = {}) => (method: string, url: string): Envelope => {
  if (method !== 'get') throw new Error(`dry-run must not ${method.toUpperCase()} ${url}`);
  if (url.endsWith('/dependencies/check')) return w.failDeps ?? ok(w.deps ?? depsOk);
  if (url.includes('/versions/')) return ok(w.version ?? version);
  return ok(w.detail ?? detail);
};

const dry = (extra: string[], w: World = {}) =>
  runCli(registerTemplateCommands, ['template', 'use', '4', '--org', '3', '--product', '9', '--dry-run', ...extra], world(w));

/** Nothing but GETs may have happened. */
function expectReadOnly(r: Awaited<ReturnType<typeof dry>>) {
  expect(r.http.post).not.toHaveBeenCalled();
  expect(r.http.put).not.toHaveBeenCalled();
  expect(r.http.delete).not.toHaveBeenCalled();
}

describe('template use --dry-run', () => {
  it('reads the template + dependency check, renders locally, and makes no write request', async () => {
    const r = await dry(['--module', '55', '--var', 'feature=登录', '--var', 'due=2026-10-01']);
    expectReadOnly(r);
    expect(r.exitCode).toBeUndefined();
    expect(r.http.get).toHaveBeenCalledWith('/templates/4', { params: undefined });
    expect(r.http.get).toHaveBeenCalledWith('/templates/4/dependencies/check', { params: { orgId: 3 } });
    expect(r.stdout).toContain('DRY-RUN 预演：没有创建任何对象');
    expect(r.stdout).toContain('模板 #4 登录功能开发 (TASK)  版本 1.0.0');
    expect(r.stdout).toContain('组织 #3  产品 #9  模块 #55');
    expect(r.stdout).toContain('将创建: 2 个任务，建入模块 #55');
    expect(r.stdout).toContain('"name": "登录：设计"');
    expect(r.stdout).toContain('"description": "工时 8，级别 low，截止 2026-10-01"'); // defaults filled in
    expect(r.stdout).toMatch(/hours\s+8/);
    expect(r.stdout).toContain('预检: ✓');
    expect(r.stdout).toContain('未验证（只有服务端能判断）');
  });

  it('--json carries ready, issues, typed variables and the rendered content', async () => {
    const r = await dry(['--module', '55', '--var', 'feature=登录', '--var', 'hours=12.50', '--json']);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({
      dryRun: true, ready: true, templateId: 4, templateType: 'TASK', version: '1.0.0', issues: [],
      target: { orgId: 3, productId: 9, moduleId: 55 }, variables: { feature: '登录', hours: '12.50', level: 'low' },
    });
    expect(out.renderedContent.tasks[1]).toEqual({ name: '登录：开发', dependsOn: ['a'] });
    expectReadOnly(r);
  });

  it('a substituted value is never expanded again (single pass)', async () => {
    const r = await dry(['--module', '55', '--var', 'feature={{level}}', '--json']);
    expect(JSON.parse(r.stdout).renderedContent.tasks[0].name).toBe('{{level}}：设计');
  });

  it('validates variables against the version definitions and stops (no further request) on the first problem', async () => {
    const cases: Array<[string[], string]> = [
      [['--var', 'feature=x', '--var', 'hours=1e100000'], '变量 hours: 必须是普通小数'],
      [['--var', 'feature=x', '--var', 'hours=1e5'], '不支持指数写法'],
      [['--var', 'feature=x', '--var', 'level=mid'], '变量 level: 必须是'],
      [['--var', 'feature=x', '--var', 'due=2026-13-01'], '变量 due'],
      [['--var', 'feature=x', '--var', 'nope=1'], '变量 nope 未在该模板版本中定义'],
      [[], '缺少必填变量: feature'],
      [['--var', 'feature='], '缺少必填变量: feature'],
    ];
    for (const [extra, needle] of cases) {
      const r = await dry(['--module', '55', ...extra]);
      expect(r.exitCode, extra.join(' ')).toBe(1);
      expect(r.stderr).toContain('参数错误');
      expect(r.stderr).toContain(needle);
      expectReadOnly(r);
    }
  });

  it('exponent numbers in a vars file are refused before anything is fetched', async () => {
    const file = path.join(dir, 'exp.json');
    fs.writeFileSync(file, '{"feature":"x","hours":1e100000}');
    const r = await dry(['--module', '55', '--vars-file', file]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/数字超出可表示范围|指数/);
    expect(r.http.get).not.toHaveBeenCalled();
  });

  it('a variable that would push the output over 2 MB is refused', async () => {
    const big = { ...detail, version: { ...version, content: { tasks: [{ name: '{{feature}}'.repeat(500) }] } } };
    const r = await dry(['--module', '55', '--var', `feature=${'y'.repeat(5000)}`], { detail: big });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('渲染结果超过 2 MB 上限');
    expectReadOnly(r);
  });

  it('TASK without --module is reported as a blocking issue (server 1000), other types ignore it with a note', async () => {
    const r = await dry(['--var', 'feature=x']);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('预检: ✗ 预计会失败');
    expect(r.stdout).toContain('TASK 模板必须指定 --module');
    expect(JSON.parse((await dry(['--var', 'feature=x', '--json'])).stdout).ready).toBe(false);
    const doc = { ...detail, templateType: 'API', version: { ...version, variables: [], content: { format: 'markdown', body: '# 接口' } } };
    const ignored = await dry(['--module', '5', '--suite', '6', '--start', '2026-10-01'], { detail: doc });
    expect(ignored.stdout).toContain('注: --module 对 API 类型无效');
    expect(ignored.stdout).toContain('注: --suite 对 API 类型无效');
    expect(ignored.stdout).toContain('注: --start / --end 对 API 类型无效');
    expect(ignored.stdout).toContain('将创建: 文档型实例');
    expect(ignored.stdout).toContain('渲染结果 (markdown):\n# 接口');
    expect(ignored.stdout).toContain('预检: ✓');
  });

  it('a RELEASE whose rendered version is empty is a blocking issue', async () => {
    const release = { ...detail, templateType: 'RELEASE', version: { ...version, variables: [{ name: 'v', type: 'string', required: false }], content: { name: '发布', version: '{{v}}' } } };
    const r = await dry(['--start', '2026-10-01', '--end', '2026-10-31'], { detail: release });
    expect(r.stdout).toContain('RELEASE 渲染出的 version 为空');
    const good = await dry(['--var', 'v=1.2.0'], { detail: release });
    expect(good.stdout).toContain('将创建: 1 个发布「发布」版本号 1.2.0');
    expect(good.stdout).toContain('预检: ✓');
  });

  it('missing required dependencies fail the pre-check unless --with-deps can install them', async () => {
    const missing = await dry(['--module', '55', '--var', 'feature=x'], { deps: depsMissing });
    expect(missing.stdout).toContain('✗ 缺少 1 个必需依赖');
    expect(missing.stdout).toMatch(/缺少 1 个必需依赖（服务端 1007）：先安装，或加 --with-deps/);
    const withDeps = await dry(['--module', '55', '--var', 'feature=x', '--with-deps'], { deps: depsMissing });
    expect(withDeps.stdout).toContain('预检: ✓');
    const stuck = { ...depsMissing, items: [{ ...depsMissing.items[0], status: 'UNAVAILABLE', installable: false }] };
    const hopeless = await dry(['--module', '55', '--var', 'feature=x', '--with-deps'], { deps: stuck });
    expect(hopeless.stdout).toContain('装不上，即使 --with-deps 也会失败');
    expectReadOnly(withDeps);
  });

  it('--version reads that version and checks it against the dependency endpoint', async () => {
    const r = await dry(['--module', '55', '--var', 'feature=x', '--version', '1.0.0'], { version: { ...version, version: '1.0.0' } });
    expect(r.http.get).toHaveBeenCalledWith('/templates/4/versions/1.0.0', { params: undefined });
    expect(r.http.get).toHaveBeenCalledWith('/templates/4/dependencies/check', { params: { orgId: 3, version: '1.0.0' } });
    const draft = await dry(['--module', '55', '--var', 'feature=x', '--version', '1.0.0'], { version: { ...version, status: 'DRAFT' } });
    expect(draft.stdout).toContain('版本 1.0.0 没有发布过');
  });

  it('flags an unpublished template and a template with no published version', async () => {
    const suspended = await dry(['--module', '55', '--var', 'feature=x'], { detail: { ...detail, status: 'SUSPENDED' } });
    expect(suspended.stdout).toContain('模板状态为 SUSPENDED');
    const none = await dry(['--module', '55'], { detail: { ...detail, version: null } });
    expect(none.exitCode).toBe(1);
    expect(none.stderr).toContain('没有已发布版本');
  });

  it('server errors while reading map to the T2 wording (1002 not visible, 2000 not a member)', async () => {
    expect((await dry(['--module', '55', '--var', 'feature=x'], { failDeps: bizError(2000, 'no') })).stderr).toContain('你不是目标组织的活跃成员');
    const notVisible = await runCli(registerTemplateCommands, ['template', 'use', '4', '--org', '3', '--product', '9', '--dry-run'], () => bizError(1002, 'nf'));
    expect(notVisible.stderr).toContain('不存在或对你不可见');
  });

  it('--out writes the preview (document body) with the same overwrite rules, and still never POSTs', async () => {
    const doc = { ...detail, templateType: 'API', version: { ...version, variables: [{ name: 't', type: 'string', required: true }], content: { format: 'markdown', body: '# {{t}}' } } };
    const file = path.join(dir, 'preview.md');
    const r = await dry(['--var', 't=登录', '--out', file], { detail: doc });
    expect(fs.readFileSync(file, 'utf-8')).toBe('# 登录\n');
    expect(r.stdout).toContain(`✓ 渲染结果已写入 ${file}`);
    const again = await dry(['--var', 't=登录', '--out', file], { detail: doc });
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain('已存在，不会覆盖');
    expect(again.http.get).not.toHaveBeenCalled();
    expectReadOnly(r);
  });

  it('nothing at all is requested when a flag is invalid', async () => {
    const r = await dry(['--start', '2026-02-30']);
    expect(r.exitCode).toBe(1);
    expect(r.http.get).not.toHaveBeenCalled();
  });
});
