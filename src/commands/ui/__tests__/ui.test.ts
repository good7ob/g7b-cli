import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerUiCommands } from '../index';
import { Responder, bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const ui = (args: string[], response: Responder = ok(null)) => runCli(registerUiCommands, ['ui', ...args], response);

afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await ui(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

let dir: string;
let png: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-cli-'));
  png = path.join(dir, 'home.png');
  fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dir, 'a.png'), 'a');
  fs.writeFileSync(path.join(dir, 'b.jpg'), 'b');
  fs.writeFileSync(path.join(dir, 'x.pdf'), 'x');
  fs.writeFileSync(path.join(dir, 'empty.png'), '');
});

describe('ui app', () => {
  it('lists apps of an org', async () => {
    const r = await ui(['app', 'list', '--org', '7'], ok([{ id: 1, name: '官网', platform: 'web' }]));
    expect(r.http.get).toHaveBeenCalledWith('/forge/ui-design/apps', { params: { orgId: 7 } });
    expect(r.stdout).toContain('官网');
  });

  it('creates an app and validates platform / org / name', async () => {
    const r = await ui(['app', 'create', '--org', '7', '--name', '官网', '--platform', 'web', '--sort', '2'], ok({ id: 3 }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ui-design/apps', { orgId: 7, name: '官网', platform: 'web', sortOrder: 2 });
    expect(r.stdout).toContain('#3');
    await expectRejected(['app', 'create', '--org', '7', '--name', 'x', '--platform', 'desktop'], '--platform');
    await expectRejected(['app', 'create', '--org', 'x', '--name', 'x', '--platform', 'web'], '--org');
    await expectRejected(['app', 'create', '--org', '7', '--name', ' ', '--platform', 'web'], '--name');
  });

  // idea #167: apps by product
  it('lists apps of a product, optionally with the org\'s unassigned apps', async () => {
    const r = await ui(['app', 'list', '--product', '10'], ok([{ id: 1, name: '官网', platform: 'web', productId: 10 }, { id: 2, name: '旧', platform: 'ios', productId: null }]));
    expect(r.http.get).toHaveBeenCalledWith('/forge/ui-design/apps', { params: { productId: 10 } });
    expect(r.stdout).toContain('未归属');
    const all = await ui(['app', 'list', '--org', '7', '--product', '10', '--include-unassigned'], ok([]));
    expect(all.http.get).toHaveBeenCalledWith('/forge/ui-design/apps', { params: { orgId: 7, productId: 10, includeUnassigned: true } });
    const orgOnly = await ui(['app', 'list', '--org', '7', '--include-unassigned'], ok([]));
    expect(orgOnly.http.get).toHaveBeenCalledWith('/forge/ui-design/apps', { params: { orgId: 7 } });
    await expectRejected(['app', 'list'], '--product');
    await expectRejected(['app', 'list', '--product', 'x'], '--product');
  });

  it('creates an app in a product without --org', async () => {
    const r = await ui(['app', 'create', '--product', '10', '--name', '官网', '--platform', 'web'], ok({ id: 3 }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ui-design/apps', { productId: 10, name: '官网', platform: 'web' });
    await expectRejected(['app', 'create', '--name', 'x', '--platform', 'web'], '--org');
  });

  it('assigns / clears the product of an app', async () => {
    const r = await ui(['app', 'set-product', '3', '--product', '10'], ok({ id: 3, productId: 10 }));
    expect(r.http.put).toHaveBeenCalledWith('/forge/ui-design/apps/3/product', { productId: 10 });
    const none = await ui(['app', 'set-product', '3', '--none'], ok({ id: 3, productId: null }));
    expect(none.http.put).toHaveBeenCalledWith('/forge/ui-design/apps/3/product', { productId: null });
    expect(none.stdout).toContain('未归属');
    await expectRejected(['app', 'set-product', '3'], '--none');
    await expectRejected(['app', 'set-product', '3', '--product', '10', '--none'], '--none');
  });

  it('deletes by id', async () => {
    const r = await ui(['app', 'delete', '3']);
    expect(r.http.delete).toHaveBeenCalledWith('/forge/ui-design/apps/3', undefined);
    await expectRejected(['app', 'delete', 'abc'], 'appId');
  });

  it('surfaces a business error (no admin rights)', async () => {
    const r = await ui(['app', 'create', '--org', '7', '--name', 'a', '--platform', 'web'], bizError(403, '无权限'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('创建应用失败');
  });
});

describe('ui screen', () => {
  it('creates with only the given fields', async () => {
    const r = await ui(['screen', 'create', '4', '--name', '首页', '--code', 'SCR-1', '--status', 'active'], ok({ id: 9 }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ui-design/apps/4/screens', { name: '首页', screenCode: 'SCR-1', status: 'active' });
    await expectRejected(['screen', 'create', '4', '--status', 'active'], '--name');
    await expectRejected(['screen', 'create', '4', '--name', 'a', '--status', 'gone'], '--status');
  });

  it('update re-sends current values the flags leave out (PUT overwrites everything)', async () => {
    const current = { id: 9, name: '首页', screenCode: 'SCR-1', routePath: '/home', category: 'main', status: 'planned', sortOrder: 3 };
    const r = await ui(['screen', 'update', '9', '--app', '4', '--status', 'active'], (m) => (m === 'get' ? ok([current]) : ok({ id: 9 })));
    expect(r.http.get).toHaveBeenCalledWith('/forge/ui-design/apps/4/screens', { params: undefined });
    expect(r.http.put).toHaveBeenCalledWith('/forge/ui-design/screens/9',
      { name: '首页', screenCode: 'SCR-1', routePath: '/home', category: 'main', status: 'active', sortOrder: 3 });
  });

  it('--parent creates / moves a sub-screen, --main detaches it, neither leaves the parent alone (#168)', async () => {
    const created = await ui(['screen', 'create', '4', '--name', '物流', '--parent', '9'], ok({ id: 10 }));
    expect(created.http.post).toHaveBeenCalledWith('/forge/ui-design/apps/4/screens', { name: '物流', screenType: 'sub', parentScreenId: 9 });

    const current = { id: 10, name: '物流', parentScreenId: 9 };
    const get = (m: string) => (m === 'get' ? ok([current]) : ok({ id: 10 }));
    const detached = await ui(['screen', 'update', '10', '--app', '4', '--main'], get);
    expect(detached.http.put).toHaveBeenCalledWith('/forge/ui-design/screens/10', { name: '物流', screenType: 'main' });
    const renamed = await ui(['screen', 'update', '10', '--app', '4', '--name', '物流跟踪'], get);
    expect(renamed.http.put).toHaveBeenCalledWith('/forge/ui-design/screens/10', { name: '物流跟踪' });

    await expectRejected(['screen', 'create', '4', '--name', 'a', '--parent', 'x'], '--parent');
    await expectRejected(['screen', 'create', '4', '--name', 'a', '--parent', '9', '--main'], '--main');
  });

  it('lists the parent of sub-screens', async () => {
    const r = await ui(['screen', 'list', '4'], ok([{ id: 9, name: '订单详情' }, { id: 10, name: '物流', parentScreenId: 9 }]));
    expect(r.stdout).toContain('PARENT');
    expect(r.stdout.split('\n').find((l) => l.includes('物流'))).toMatch(/物流\s+9\s/);
  });

  it('update refuses a screen that is not under --app', async () => {
    const r = await ui(['screen', 'update', '9', '--app', '4', '--name', 'x'], ok([{ id: 1, name: 'other' }]));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--app');
    expect(r.http.put).not.toHaveBeenCalled();
  });
});

describe('ui version', () => {
  it('creates an active version; --active and --inactive conflict', async () => {
    const r = await ui(['version', 'create', '9', '--type', 'proposal', '--label', 'v2', '--active'], ok({ id: 5 }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ui-design/screens/9/versions', { versionType: 'proposal', label: 'v2', isActive: true });
    await expectRejected(['version', 'create', '9', '--type', 'proposal', '--label', 'v', '--active', '--inactive'], '--inactive');
    await expectRejected(['version', 'create', '9', '--type', 'old', '--label', 'v'], '--type');
  });

  it('update keeps type/label/description and leaves isActive untouched unless asked', async () => {
    const current = { id: 5, versionType: 'current', label: 'v1', description: 'd', isActive: true };
    const r = await ui(['version', 'update', '5', '--screen', '9', '--label', 'v1.1'], (m) => (m === 'get' ? ok([current]) : ok({ id: 5 })));
    expect(r.http.put).toHaveBeenCalledWith('/forge/ui-design/versions/5', { versionType: 'current', label: 'v1.1', description: 'd' });
    const off = await ui(['version', 'update', '5', '--screen', '9', '--inactive'], (m) => (m === 'get' ? ok([current]) : ok({ id: 5 })));
    expect(off.http.put.mock.calls[0][1]).toMatchObject({ isActive: false });
  });
});

describe('ui screenshot', () => {
  const upload = (url: string): Responder => (m, u) => (m === 'post' && u === '/file/upload2s3' ? ok({ fileUrl: url }) : ok({ id: 11, fileUrl: url }));

  it('uploads a local image via /file/upload2s3, then registers its URL', async () => {
    const r = await ui(['screenshot', 'add', '5', '--file', png, '--caption', '首页'], upload('https://b.s3.amazonaws.com/public/home.png'));
    const [upUrl, , upCfg] = r.http.post.mock.calls[0];
    expect(upUrl).toBe('/file/upload2s3');
    expect(upCfg.headers['content-type']).toContain('multipart/form-data');
    expect(r.http.post.mock.calls[1]).toEqual(['/forge/ui-design/versions/5/screenshots',
      { caption: '首页', fileUrl: 'https://b.s3.amazonaws.com/public/home.png' }]);
    expect(r.stdout).toContain('#11');
  });

  it('adds several files in order with incrementing sort', async () => {
    const r = await ui(['screenshot', 'add', '5', '--file', path.join(dir, 'a.png'), '--file', path.join(dir, 'b.jpg'), '--sort', '10'], upload('https://h/x.png'));
    const registered = r.http.post.mock.calls.filter((c) => c[0] !== '/file/upload2s3').map((c) => c[1].sortOrder);
    expect(registered).toEqual([10, 11]);
  });

  it('registers an existing https URL without uploading', async () => {
    const r = await ui(['screenshot', 'add', '5', '--url', 'https://cdn.example.com/a.png', '--thumbnail', 'https://cdn.example.com/t.png'], ok({ id: 2 }));
    expect(r.http.post).toHaveBeenCalledTimes(1);
    expect(r.http.post).toHaveBeenCalledWith('/forge/ui-design/versions/5/screenshots',
      { thumbnailUrl: 'https://cdn.example.com/t.png', fileUrl: 'https://cdn.example.com/a.png' });
  });

  it('rejects bad input before any HTTP call', async () => {
    await expectRejected(['screenshot', 'add', '5'], '--file');
    await expectRejected(['screenshot', 'add', '5', '--file', png, '--url', 'https://a/b.png'], '不能同时');
    await expectRejected(['screenshot', 'add', '5', '--file', path.join(dir, 'x.pdf')], '只支持图片');
    await expectRejected(['screenshot', 'add', '5', '--file', path.join(dir, 'empty.png')], '空文件');
    await expectRejected(['screenshot', 'add', '5', '--file', path.join(dir, 'nope.png')], '不是可读文件');
    await expectRejected(['screenshot', 'add', '5', '--url', 'http://a/b.png'], 'https');
    await expectRejected(['screenshot', 'add', '5', '--file', path.join(dir, 'a.png'), '--file', path.join(dir, 'b.jpg'), '--caption', 'c'], '多个');
  });

  it('reports what was already added when a later upload fails', async () => {
    let posts = 0;
    const r = await ui(['screenshot', 'add', '5', '--file', path.join(dir, 'a.png'), '--file', path.join(dir, 'b.jpg')], (m, u) => {
      if (m !== 'post') return ok(null);
      posts += 1;
      return posts === 3 ? bizError(500, '文件过大') : u === '/file/upload2s3' ? ok({ fileUrl: 'https://h/x.png' }) : ok({ id: 11 });
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('已成功添加 1 张: #11');
  });
});

describe('ui preview', () => {
  const html = () => { const f = path.join(dir, 'p.html'); fs.writeFileSync(f, '<html></html>'); return f; };

  it('uploads multipart with screenId and thumbnail', async () => {
    const r = await ui(['preview', 'add', '--org', '7', '--name', '首页稿', '--file', html(), '--screen', '9', '--thumbnail', png], ok({ preview: { id: 4 } }));
    const [url, form, cfg] = r.http.post.mock.calls[0];
    expect(url).toBe('/api/v1/ui-previews');
    expect(cfg.headers['content-type']).toContain('multipart/form-data');
    const raw = form.getBuffer().toString();
    expect(raw).toContain('name="screenId"');
    expect(raw).toContain('name="thumbnail"');
    expect(raw).toContain('name="file"');
    expect(r.stdout).toContain('#4');
  });

  it('lists previews filtered by screen', async () => {
    const r = await ui(['preview', 'list', '--org', '7', '--screen', '9'], ok([{ preview: { id: 4, name: '首页稿', kind: 'HTML', screenId: 9 } }]));
    expect(r.http.get).toHaveBeenCalledWith('/api/v1/ui-previews', { params: { orgId: 7, screenId: 9 } });
    expect(r.stdout).toContain('首页稿');
  });

  it('rejects bad input before any HTTP call', async () => {
    await expectRejected(['preview', 'add', '--org', '7', '--name', 'n', '--file', path.join(dir, 'x.pdf')], '只支持');
    await expectRejected(['preview', 'add', '--org', '7', '--name', 'n', '--file', path.join(dir, 'nope.html')], '不是可读文件');
    await expectRejected(['preview', 'add', '--org', '7', '--name', 'n', '--file', html(), '--screen', 'abc'], '--screen');
    await expectRejected(['preview', 'add', '--org', '7', '--name', 'n', '--file', html(), '--thumbnail', path.join(dir, 'b.jpg')], '--thumbnail');
  });
});

describe('ui flow / node', () => {
  it('creates a flow and updates it keeping the description', async () => {
    const created = await ui(['flow', 'create', '4', '--name', '下单流程'], ok({ id: 8 }));
    expect(created.http.post).toHaveBeenCalledWith('/forge/ui-design/apps/4/flows', { name: '下单流程' });
    const r = await ui(['flow', 'update', '8', '--app', '4', '--name', '下单'], (m) => (m === 'get' ? ok([{ id: 8, name: '下单流程', description: 'd', sortOrder: 1 }]) : ok({ id: 8 })));
    expect(r.http.put).toHaveBeenCalledWith('/forge/ui-design/flows/8', { name: '下单', description: 'd', sortOrder: 1 });
  });

  it('adds an entry node and a normal node; --entry excludes --from', async () => {
    const entry = await ui(['node', 'add', '8', '--entry', '--to', '9', '--trigger', '打开 App'], ok({ id: 1 }));
    expect(entry.http.post).toHaveBeenCalledWith('/forge/ui-design/flows/8/nodes', { fromScreenId: null, toScreenId: 9, triggerDesc: '打开 App' });
    const mid = await ui(['node', 'add', '8', '--from', '9', '--to', '10'], ok({ id: 2 }));
    expect(mid.http.post.mock.calls[0][1]).toEqual({ fromScreenId: 9, toScreenId: 10 });
    await expectRejected(['node', 'add', '8', '--entry', '--from', '9', '--to', '10'], '--entry');
    await expectRejected(['node', 'add', '8', '--from', '9'], '--to');
  });

  it('update keeps from / trigger when not given', async () => {
    const current = { id: 2, fromScreenId: 9, toScreenId: 10, triggerDesc: '点击', conditionDesc: '', sortOrder: 0 };
    const r = await ui(['node', 'update', '2', '--flow', '8', '--to', '11'], (m) => (m === 'get' ? ok([current]) : ok({ id: 2 })));
    expect(r.http.put).toHaveBeenCalledWith('/forge/ui-design/nodes/2',
      { fromScreenId: 9, toScreenId: 11, triggerDesc: '点击', conditionDesc: '', sortOrder: 0 });
  });

  it('lists transitions with screen names when --app is given', async () => {
    const r = await ui(['node', 'list', '8', '--app', '4'], (m, u) => (u.endsWith('/nodes')
      ? ok([{ id: 1, fromScreenId: null, toScreenId: 9, triggerDesc: '打开' }, { id: 2, fromScreenId: 9, toScreenId: 10 }])
      : ok([{ id: 9, name: '首页' }, { id: 10, name: '详情' }])));
    expect(r.stdout).toContain('(入口)');
    expect(r.stdout).toContain('#9 首页');
    expect(r.stdout).toContain('#10 详情');
    const json = await ui(['node', 'list', '8', '--json'], ok([{ id: 1 }]));
    expect(JSON.parse(json.stdout)).toEqual([{ id: 1 }]);
  });
});
