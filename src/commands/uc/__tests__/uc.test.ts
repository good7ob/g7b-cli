import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../../services/ApiClient';
import { Envelope, Responder, bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { registerUcCommands } from '../index';
import { sourceHash } from '../source';
import { fakeTools } from './fakeTools';

const uc = (args: string[], response: Responder = ok(null)) => runCli(registerUcCommands, ['uc', ...args], response);

/** Route by "METHOD /path"; unknown routes answer ok(null). */
const routes = (table: Record<string, Envelope | (() => Envelope)>): Responder => (method, url) => {
  const hit = table[`${method.toUpperCase()} ${url}`];
  return typeof hit === 'function' ? hit() : hit ?? ok(null);
};

const DETAIL = {
  id: 5, productId: 7, code: 'UC-5', seqNo: 5, goal: '邀请成员', priority: 'P1', actorId: 3, actorName: '组织管理员',
  subModuleId: 4, note: '备注', targetReleaseId: 9, targetMilestoneId: null, channels: ['WEB', 'CLI'],
  channelEntries: [{ channel: 'WEB', entries: [{ id: 1, entryRef: '/org/invite', functionPointId: 21 }] }, { channel: 'CLI', entries: [] }],
  functionPoints: [{ functionPointId: 21, code: 'fun-org-0001', name: '邀请成员', reqStatus: 'REVIEWED', implStatus: 'COMPLETED', invalid: false }],
  testCases: [], relations: { includes: [{ relationId: 8, type: 'INCLUDE', useCaseId: 6, code: 'UC-6', goal: '登录' }] },
};

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; vi.restoreAllMocks(); });

describe('uc references and the product', () => {
  it('show with an id reads the use case and renders gaps and relations', async () => {
    const r = await uc(['show', '5'], ok(DETAIL));
    expect(r.http.get).toHaveBeenCalledWith('/use-cases/5', { params: undefined });
    expect(r.stdout).toContain('UC-5');
    expect(r.stdout).toContain('CLI: ⚠ 未声明入口');
    expect(r.stdout).toContain('include → UC-6');
    expect(r.stdout).toContain('fun-org-0001');
  });

  it('show UC-3 finds the id in the product list first (needs --product or GOOD7OB_PRODUCT_ID)', async () => {
    const list = ok({ records: [{ id: 11, seqNo: 1 }, { id: 15, seqNo: 3 }], pages: 1 });
    const r = await uc(['show', 'UC-3', '--product', '7'], routes({ 'GET /products/7/use-cases': list, 'GET /use-cases/15': ok({ ...DETAIL, id: 15, code: 'UC-3' }) }));
    expect(r.http.get).toHaveBeenNthCalledWith(1, '/products/7/use-cases', { params: { pageNum: 1, pageSize: 100 } });
    expect(r.http.get).toHaveBeenNthCalledWith(2, '/use-cases/15', { params: undefined });
    const none = await uc(['show', 'UC-9', '--product', '7'], routes({ 'GET /products/7/use-cases': list }));
    expect(none.exitCode).toBe(1);
    expect(none.stderr).toContain('没有用例 UC-9');
    delete process.env.GOOD7OB_PRODUCT_ID;
    const noProduct = await uc(['show', 'UC-3']);
    expect(noProduct.stderr).toContain('缺少产品 ID');
    expect(noHttpCalls(noProduct)).toBe(true);
  });
});

describe('rp-ucase-0081 use case read and write', () => {
  it('list passes the filters', async () => {
    const r = await uc(['list', '--product', '7', '--priority', 'p0', '--channel', 'cli', '--size', '50'],
      ok({ records: [{ id: 5, code: 'UC-5', goal: '邀请', priority: 'P0', actorName: 'A', channels: ['CLI'], noFunctionPoint: true }], total: 1, current: 1, pages: 1 }));
    expect(r.http.get).toHaveBeenCalledWith('/products/7/use-cases', { params: { priority: 'P0', channel: 'CLI', pageSize: 50 } });
    expect(r.stdout).toContain('未关联');
  });

  it('add resolves an actor given by name and posts the full body', async () => {
    const r = await uc(['add', '--product', '7', '--actor', 'AI员工', '--goal', ' 导出报表 ', '--priority', 'p1', '--channel', 'web,cli,web', '--sub-module', '4'],
      routes({
        'GET /products/7/use-case-actors': ok([{ id: 2, name: 'AI 员工', enabled: true }]),
        'POST /products/7/use-cases': ok({ ...DETAIL, code: 'UC-6', goal: '导出报表' }),
      }));
    expect(r.http.post).toHaveBeenCalledWith('/products/7/use-cases', { actorId: 2, goal: '导出报表', priority: 'P1', channels: ['WEB', 'CLI'], subModuleId: 4 });
    expect(r.stdout).toContain('UC-6');
  });

  it('add rejects a bad priority / channel / goal before any request', async () => {
    for (const bad of [['--priority', 'P9'], ['--channel', 'fax'], ['--goal', ' ']]) {
      const args = ['add', '--product', '7', '--actor', '2', '--goal', 'g', '--priority', 'P0', '--channel', 'web', ...bad];
      const r = await uc(args);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('参数错误');
      expect(noHttpCalls(r)).toBe(true);
    }
  });

  it('update reads the use case, merges, and PUTs every field (PUT replaces: nothing is cleared by accident)', async () => {
    const r = await uc(['update', '5', '--priority', 'p0'], routes({ 'GET /use-cases/5': ok(DETAIL), 'PUT /use-cases/5': ok({ ...DETAIL, priority: 'P0' }) }));
    expect(r.http.get).toHaveBeenCalledWith('/use-cases/5', { params: undefined });
    expect(r.http.put).toHaveBeenCalledWith('/use-cases/5', { actorId: 3, goal: '邀请成员', priority: 'P0', subModuleId: 4, note: '备注', targetReleaseId: 9 });
  });

  it('update --clear empties exactly the named optional fields; a flag and its clear cannot be combined', async () => {
    const responses = routes({ 'GET /use-cases/5': ok(DETAIL), 'PUT /use-cases/5': ok(DETAIL) });
    const r = await uc(['update', '5', '--clear', 'note,release', '--goal', '新目标'], responses);
    expect(r.http.put).toHaveBeenCalledWith('/use-cases/5', { actorId: 3, goal: '新目标', priority: 'P1', subModuleId: 4 });
    const conflict = await uc(['update', '5', '--note', 'x', '--clear', 'note'], responses);
    expect(conflict.exitCode).toBe(1);
    expect(conflict.http.put).not.toHaveBeenCalled();
  });

  it('update with nothing to change makes no request at all', async () => {
    const r = await uc(['update', '5']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('没有要修改的字段');
    expect(noHttpCalls(r)).toBe(true);
  });

  it('delete sends confirm=false, and the server’s 15007 tells the user to add --confirm; --confirm sends true', async () => {
    const blocked = await uc(['delete', '5'], bizError(15007, '用例被引用: UC-7、UC-9'));
    expect(blocked.http.delete).toHaveBeenCalledWith('/use-cases/5?confirm=false', undefined);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain('--confirm');
    expect(blocked.stderr).toContain('UC-7');
    const confirmed = await uc(['delete', '5', '--confirm'], ok(null));
    expect(confirmed.http.delete).toHaveBeenCalledWith('/use-cases/5?confirm=true', undefined);
    expect(confirmed.exitCode).toBeUndefined();
  });
});

describe('rp-ucase-0081 actors, links, entries, relations', () => {
  it('manages actors', async () => {
    const created = await uc(['actors', 'add', '访客', '--product', '7'], ok({ id: 9, name: '访客' }));
    expect(created.http.post).toHaveBeenCalledWith('/products/7/use-case-actors', { name: '访客' });
    const renamed = await uc(['actors', 'rename', '9', '游客', '--product', '7'], ok({ id: 9, name: '游客' }));
    expect(renamed.http.put).toHaveBeenCalledWith('/products/7/use-case-actors/9', { name: '游客' });
    const disabled = await uc(['actors', 'disable', '9', '--product', '7'], ok({ id: 9, name: '游客' }));
    expect(disabled.http.put).toHaveBeenCalledWith('/products/7/use-case-actors/9', { enabled: false });
    const listed = await uc(['actors', 'list', '--product', '7'], ok([{ id: 9, name: '游客', enabled: false, useCaseCount: 0 }]));
    expect(listed.stdout).toContain('已停用');
  });

  it('link-fp takes an id directly, or finds a code through the candidate search of the use case’s product', async () => {
    const byId = await uc(['link-fp', '5', '21'], ok(DETAIL));
    expect(byId.http.post).toHaveBeenCalledWith('/use-cases/5/functions', { functionPointId: 21 });
    const byCode = await uc(['link-fp', '5', 'FUN-ORG-0001'], routes({
      'GET /use-cases/5': ok(DETAIL),
      'GET /products/7/use-case-candidates/functions': ok([{ functionPointId: 99, code: 'fun-org-00010' }, { functionPointId: 21, code: 'fun-org-0001' }]),
      'POST /use-cases/5/functions': ok(DETAIL),
    }));
    expect(byCode.http.post).toHaveBeenCalledWith('/use-cases/5/functions', { functionPointId: 21 });
    const missing = await uc(['link-fp', '5', 'fun-x-9'], routes({ 'GET /use-cases/5': ok(DETAIL), 'GET /products/7/use-case-candidates/functions': ok([]) }));
    expect(missing.exitCode).toBe(1);
    expect(missing.http.post).not.toHaveBeenCalled();
  });

  it('unlink-fp / link-test / unlink-test hit the contract paths', async () => {
    expect((await uc(['unlink-fp', '5', '21'], ok(DETAIL))).http.delete).toHaveBeenCalledWith('/use-cases/5/functions/21', undefined);
    expect((await uc(['link-test', '5', '33'], ok(DETAIL))).http.post).toHaveBeenCalledWith('/use-cases/5/test-cases', { testCaseId: 33 });
    expect((await uc(['unlink-test', '5', '33'], ok(DETAIL))).http.delete).toHaveBeenCalledWith('/use-cases/5/test-cases/33', undefined);
  });

  it('unlink-fp surfaces 15011 with the way out', async () => {
    const r = await uc(['unlink-fp', '5', '21'], bizError(15011, '还承载入口 WEB /org/invite 共 1 条'));
    expect(r.stderr).toContain('uc entry remove');
  });

  it('entry add / remove, channels set', async () => {
    const add = await uc(['entry', 'add', '5', '--channel', 'web', '--ref', ' /org/invite ', '--fp', '21'], ok(DETAIL));
    expect(add.http.post).toHaveBeenCalledWith('/use-cases/5/entries', { channel: 'WEB', entryRef: '/org/invite', functionPointId: 21 });
    expect((await uc(['entry', 'remove', '5', '1'], ok(DETAIL))).http.delete).toHaveBeenCalledWith('/use-cases/5/entries/1', undefined);
    expect((await uc(['channels', 'set', '5', 'web,api'], ok(DETAIL))).http.put).toHaveBeenCalledWith('/use-cases/5/channels', { channels: ['WEB', 'API'] });
  });

  it('relation add: extend needs --when, include must not have it; the target may be UC-n', async () => {
    const bad = await uc(['relation', 'add', '5', '--type', 'extend', '--target', '6']);
    expect(bad.stderr).toContain('--when');
    expect(noHttpCalls(bad)).toBe(true);
    const bad2 = await uc(['relation', 'add', '5', '--type', 'include', '--target', '6', '--when', 'x']);
    expect(noHttpCalls(bad2)).toBe(true);
    const good = await uc(['relation', 'add', '5', '--type', 'extend', '--target', 'UC-1', '--when', '邀请已过期', '--product', '7'], routes({
      'GET /products/7/use-cases': ok({ records: [{ id: 11, seqNo: 1 }], pages: 1 }),
      'POST /use-cases/5/relations': ok(DETAIL),
    }));
    expect(good.http.post).toHaveBeenCalledWith('/use-cases/5/relations', { type: 'EXTEND', targetUseCaseId: 11, triggerCondition: '邀请已过期' });
    expect((await uc(['relation', 'remove', '5', '8'], ok(DETAIL))).http.delete).toHaveBeenCalledWith('/use-cases/5/relations/8', undefined);
  });

  it('candidate search passes keyword and limit', async () => {
    const r = await uc(['candidates', 'fp', '邀请', '--product', '7', '--limit', '5'], ok([{ functionPointId: 21, code: 'fun-org-0001', name: '邀请成员', invalid: true, invalidReason: 'CANCELLED' }]));
    expect(r.http.get).toHaveBeenCalledWith('/products/7/use-case-candidates/functions', { params: { keyword: '邀请', limit: 5 } });
    expect(r.stdout).toContain('CANCELLED');
    const bad = await uc(['candidates', 'test', '--product', '7', '--limit', '99']);
    expect(noHttpCalls(bad)).toBe(true);
  });

  it('sends X-Client-Channel: cli so the server records the CLI as the source', async () => {
    await uc(['show', '5'], ok(DETAIL));
    expect(apiClient['instance'].defaults.headers.common['X-Client-Channel']).toBe('cli');
  });
});

// ── push / render, with a fake plantuml subprocess ──

const VALID = '@startuml\nAlice -> Bob : hi\n@enduml\n';
const tools = fakeTools();
let dir: string;
/** The text fields of a multipart form-data body (form-data keeps each header and value as separate string parts), and the file name under `file`. */
const formOf = (call: unknown[]): Record<string, string> => {
  const parts = ((call[1] as { _streams: unknown[] })._streams ?? []).filter((s): s is string => typeof s === 'string');
  const out: Record<string, string> = {};
  parts.forEach((part, i) => {
    const name = /name="([^"]+)"(; filename="([^"]+)")?/.exec(part);
    if (!name || !part.includes('Content-Disposition')) return;
    out[name[1]] = name[3] ?? parts[i + 1];
  });
  return out;
};
const fieldOf = (form: Record<string, string>, name: string): string | undefined => form[name];

describe('push and render', () => {
  beforeAll(() => { tools.setup(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-push-')); });
  afterAll(() => { tools.teardown(); fs.rmSync(dir, { recursive: true, force: true }); });
  beforeEach(() => { tools.reset(); tools.useCommand('plantuml'); });

  const file = (name: string, content: string) => { const p = path.join(dir, name); fs.writeFileSync(p, content); return p; };
  const pushed = ok({ id: 101, name: 'invite', currentVersionNo: 2, freshness: { label: '最新' }, latestRender: { id: 9, plantumlVersion: '1.2026.8' } });

  it('rp-ucase-0050 renders locally, then POSTs source, hash, version and the PNG as multipart', async () => {
    const f = file('invite.puml', VALID.replace(/\n/g, '\r\n'));
    const r = await uc(['push', '5', f, '--type', 'sequence'], pushed);
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post).toHaveBeenCalledTimes(1);
    const call = r.http.post.mock.calls[0];
    expect(call[0]).toBe('/use-cases/5/diagrams');
    const form = formOf(call);
    expect(fieldOf(form, 'name')).toBe('invite'); // default: the file name without extension
    expect(fieldOf(form, 'diagramType')).toBe('SEQUENCE');
    expect(fieldOf(form, 'source')).toBe(VALID); // CRLF normalized to LF
    expect(fieldOf(form, 'sourceSha256')).toBe(sourceHash(VALID));
    expect(fieldOf(form, 'plantumlVersion')).toBe('1.2026.8');
    expect(fieldOf(form, 'file')).toBe('render.png');
    expect(apiClient['instance'].defaults.headers.common['X-Client-Channel']).toBe('cli');
    expect(r.stdout).toContain('v2');
  });

  it('rp-ucase-0050 a failed render submits nothing — no request at all — prints PlantUML’s message and line, exits non-zero', async () => {
    const r = await uc(['push', 'UC-5', file('bad.puml', '@startuml\nA -> B\nBAD\n@enduml\n'), '--type', 'activity', '--name', 'x']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
    expect(r.stderr).toContain('第 3 行');
    expect(r.stderr).toContain('Syntax Error?');
    expect(r.stderr).toContain('没有提交');
  });

  it('rp-ucase-0051 refuses to push when PlantUML is missing: nothing is sent, the install hint is shown', async () => {
    tools.useCommand('plantuml-does-not-exist');
    const r = await uc(['push', '5', file('v.puml', VALID), '--type', 'sequence']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
    expect(r.stderr).toContain('brew install plantuml');
  });

  it('push validates --type and the file before rendering', async () => {
    const badType = await uc(['push', '5', file('t.puml', VALID), '--type', 'gantt']);
    expect(badType.stderr).toContain('--type');
    const missing = await uc(['push', '5', path.join(dir, 'nope.puml'), '--type', 'sequence']);
    expect(missing.stderr).toContain('找不到');
    expect(noHttpCalls(missing)).toBe(true);
    expect(tools.log()).toBe(''); // never rendered
  });

  it('push resolves UC-n only after a successful render', async () => {
    const r = await uc(['push', 'UC-3', file('c.puml', VALID), '--type', 'sequence', '--product', '7', '--name', '登录'], routes({
      'GET /products/7/use-cases': ok({ records: [{ id: 15, seqNo: 3 }], pages: 1 }), 'POST /use-cases/15/diagrams': pushed,
    }));
    expect(r.http.post.mock.calls[0][0]).toBe('/use-cases/15/diagrams');
    expect(fieldOf(formOf(r.http.post.mock.calls[0]), 'name')).toBe('登录');
  });

  // ── render ──
  const OV_OK = '@startuml\nOVERVIEW OK\n@enduml\n';
  const OV_BAD = '@startuml\nBAD overview\n@enduml\n';
  const world = (extra: Record<string, Envelope | (() => Envelope)> = {}): Responder => routes({
    'GET /products/7/use-case-diagrams': ok([
      { key: 'p0-overview', name: 'P0 总览', source: OV_OK, freshness: { upToDate: false, label: '图已过期' } },
      { key: 'sub-3', name: '组织', source: OV_OK, freshness: { upToDate: true, label: '最新' } },
      { key: 'unassigned', name: '未分模块', source: OV_BAD, freshness: { upToDate: false, label: '未渲染' } },
    ]),
    'GET /products/7/use-cases': ok({ records: [{ id: 11, seqNo: 1, code: 'UC-1' }, { id: 12, seqNo: 2, code: 'UC-2' }], pages: 1 }),
    'GET /use-cases/11/diagrams': ok([
      { id: 101, name: 'invite', freshness: { upToDate: false } }, { id: 102, name: 'done', freshness: { upToDate: true } }, { id: 103, name: 'ok', freshness: { upToDate: false } },
    ]),
    'GET /use-cases/12/diagrams': ok([]),
    'GET /use-cases/11/diagrams/101': ok({ source: '@startuml\nBAD flow\n@enduml\n' }),
    'GET /use-cases/11/diagrams/103': ok({ source: VALID }),
    'POST /products/7/use-case-diagrams/p0-overview/renders': ok({ latestRender: { id: 31, sourceSha256: sourceHash(OV_OK) } }),
    'POST /use-cases/11/diagrams/103/renders': ok({ latestRender: { id: 32, sourceSha256: sourceHash(VALID) } }),
    ...extra,
  });

  it('rp-ucase-0067 renders every stale or unrendered picture on its own: successes are kept, failures are listed one by one, exit is non-zero', async () => {
    const r = await uc(['render', '--product', '7'], world());
    const posted = r.http.post.mock.calls.map((c) => c[0]);
    expect(posted).toEqual(['/products/7/use-case-diagrams/p0-overview/renders', '/use-cases/11/diagrams/103/renders']);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('渲染 4 张：成功 2，失败 2；2 张已是最新，跳过');
    expect(r.stdout).toContain('✓ 总图 p0-overview（P0 总览）');
    expect(r.stdout).toMatch(/✗ 总图 unassigned（未分模块）: PlantUML 渲染失败\n\s+第 3 行: Syntax Error\? \(fake\)/);
    expect(r.stdout).toMatch(/✗ UC-1 流程图「invite」/);
    expect(r.stdout).toContain('✓ UC-1 流程图「ok」');
    // the hash sent is the hash of the source that was rendered
    expect(fieldOf(formOf(r.http.post.mock.calls[0]), 'sourceSha256')).toBe(sourceHash(OV_OK));
    expect(fieldOf(formOf(r.http.post.mock.calls[1]), 'plantumlVersion')).toBe('1.2026.8');
  });

  it('rp-ucase-0067 exits zero when every picture succeeds', async () => {
    const r = await uc(['render', '--product', '7', '--overview', 'p0-overview'], world());
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post).toHaveBeenCalledTimes(1);
    expect(r.stdout).toContain('成功 1，失败 0');
  });

  it('rp-ucase-0062 scopes: --overview <key|all>, --diagrams, --uc, --all', async () => {
    const onlyDiagrams = await uc(['render', '--product', '7', '--diagrams'], world());
    expect(onlyDiagrams.http.get.mock.calls.map((c) => c[0])).not.toContain('/products/7/use-case-diagrams');
    expect(onlyDiagrams.http.post.mock.calls.map((c) => c[0])).toEqual(['/use-cases/11/diagrams/103/renders']);

    const forced = await uc(['render', '--product', '7', '--overview', 'all', '--all'], world({ 'POST /products/7/use-case-diagrams/sub-3/renders': ok({}) }));
    expect(forced.http.post.mock.calls.map((c) => c[0])).toEqual([
      '/products/7/use-case-diagrams/p0-overview/renders', '/products/7/use-case-diagrams/sub-3/renders',
    ]);
    expect(forced.stdout).toContain('✗ 总图 unassigned');

    const oneUc = await uc(['render', '--product', '7', '--uc', 'UC-1'], world());
    expect(oneUc.http.get.mock.calls.map((c) => c[0])).not.toContain('/products/7/use-case-diagrams');
    expect(oneUc.stdout).toContain('UC-1 流程图「ok」');

    const unknown = await uc(['render', '--product', '7', '--overview', 'sub-99'], world());
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain('没有总图 sub-99');
  });

  it('rp-ucase-0062 on 15013 re-reads the source and renders it once more', async () => {
    let posts = 0;
    const NEW = '@startuml\nOVERVIEW CHANGED\n@enduml\n';
    const r = await uc(['render', '--product', '7', '--overview', 'p0-overview'], world({
      'POST /products/7/use-case-diagrams/p0-overview/renders': () => (++posts === 1 ? bizError(15013, '用例数据已变化') : ok({ latestRender: { id: 40 } })),
      'GET /products/7/use-case-diagrams/p0-overview': ok({ key: 'p0-overview', source: NEW }),
    }));
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post).toHaveBeenCalledTimes(2);
    expect(fieldOf(formOf(r.http.post.mock.calls[0]), 'sourceSha256')).toBe(sourceHash(OV_OK));
    expect(fieldOf(formOf(r.http.post.mock.calls[1]), 'sourceSha256')).toBe(sourceHash(NEW));
    // a second 15013 is a failure of that picture, not an endless loop
    const stubborn = await uc(['render', '--product', '7', '--overview', 'p0-overview'], world({
      'POST /products/7/use-case-diagrams/p0-overview/renders': bizError(15013, '用例数据已变化'),
      'GET /products/7/use-case-diagrams/p0-overview': ok({ source: NEW }),
    }));
    expect(stubborn.http.post).toHaveBeenCalledTimes(2);
    expect(stubborn.exitCode).toBe(1);
    expect(stubborn.stdout).toContain('✗');
  });

  it('rp-ucase-0051 without PlantUML, render is refused once with the install hint and uploads nothing', async () => {
    tools.useCommand('plantuml-does-not-exist');
    const r = await uc(['render', '--product', '7'], world());
    expect(r.exitCode).toBe(1);
    expect(r.http.post).not.toHaveBeenCalled();
    expect(r.stderr).toContain('brew install plantuml');
    expect(r.stderr.match(/找不到 PlantUML 命令/g)).toHaveLength(1);
  });

  it('says so when nothing is stale, without touching PlantUML', async () => {
    tools.useCommand('plantuml-does-not-exist');
    const r = await uc(['render', '--product', '7', '--overview', 'sub-3'], world());
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('没有需要渲染的图（1 张已是最新');
  });

  it('rp-ucase-0067 a use case whose diagram list cannot be read is a failed item, not a silent skip', async () => {
    const r = await uc(['render', '--product', '7', '--diagrams'], world({ 'GET /use-cases/12/diagrams': bizError(2000, 'no') }));
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('✗ UC-2 流程图清单');
    expect(r.http.post).toHaveBeenCalledTimes(1); // UC-1's good picture still went up
  });

  it('rp-ucase-0068 a PNG over the object-file limit is not uploaded', async () => {
    const big = file('big-fake', '#!/bin/sh\ncase "$1" in -version) echo "PlantUML version 1.2026.8"; exit 0;; esac\ncat >/dev/null\nprintf \'\\211PNG\\r\\n\\032\\n\'\nhead -c 105000000 /dev/zero\n');
    fs.chmodSync(big, 0o755);
    tools.useCommand(big);
    const r = await uc(['push', '5', file('v2.puml', VALID), '--type', 'sequence']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('100.0 MB');
    expect(noHttpCalls(r)).toBe(true);
  }, 60_000);
});
