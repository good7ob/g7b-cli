import { afterEach, describe, expect, it, vi } from 'vitest';
import { Envelope, Responder, bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { CODES, registerCompetitorCommands } from '../index';
import { todayJst } from '../input';

const cp = (args: string[], response: Responder = ok(null)) => runCli(registerCompetitorCommands, ['competitor', ...args, ...(args.includes('--product') ? [] : ['--product', '7'])], response);

/** Route by "METHOD /path"; unknown routes answer ok(null). */
const routes = (table: Record<string, Envelope | (() => Envelope)>): Responder => (method, url) => {
  const hit = table[`${method.toUpperCase()} ${url}`];
  return typeof hit === 'function' ? hit() : hit ?? ok(null);
};

const P = '/products/7';
const ACME = { id: 9, name: 'Acme', positioning: '定位', targetUsers: '中小企业', pricing: '按席位', websiteUrl: 'https://acme.example', threatLevel: 'HIGH', note: '原备注', version: 3, sourceSummary: { credibility: 'PRIMARY', lastVerifiedOn: '2026-11-01', flags: [] } };
const BETA = { id: 10, name: 'Beta Inc', threatLevel: 'LOW', version: 1, sourceSummary: { flags: ['NO_SOURCE'] } };
const EXPORT = { id: 21, name: '导出报表', note: '原说明', refType: 'FP', refId: 301 };
const CUSTOM = { id: 22, name: '私有部署', note: null };
const OWN_CELL = { capabilityId: 21, competitorId: null, value: 'YES', note: '已上线', fillMode: 'MANUAL', humanTouched: true, version: 2 };
const ACME_CELL = { capabilityId: 21, competitorId: 9, value: 'NO', note: '没有', fillMode: 'AI', humanTouched: false, version: 4, flags: ['AI_FILLED', 'NO_SOURCE'], sources: [{ id: 55, title: '官网定价页', url: 'https://acme.example/p', credibility: 'PRIMARY', verifiedOn: '2026-10-30', version: 6 }] };
const MATRIX = {
  competitors: [ACME, BETA], capabilities: [EXPORT, CUSTOM], cells: [OWN_CELL, ACME_CELL],
  summary: { competitorCount: 2, capabilityCount: 2, unknownCellCount: 2, noSourceCount: 1, staleCount: 0, pendingOpportunityCount: 1 },
  permissions: { canEdit: true, canConvertToIdea: true, canAiFill: true },
};
const OPP = { id: 7, kind: 'GAP', title: '补齐导出', description: '原说明', status: 'PENDING', origin: 'MANUAL', version: 5, capability: { id: 21, name: '导出报表' }, competitors: [{ id: 9, name: 'Acme' }], idea: null };

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; vi.restoreAllMocks(); });

describe('competitors', () => {
  it('list renders the table and --json passes the server body through', async () => {
    const r = await cp(['list'], routes({ [`GET ${P}/competitors`]: ok([ACME, BETA]) }));
    expect(r.http.get).toHaveBeenCalledWith(`${P}/competitors`, { params: undefined });
    expect(r.stdout).toContain('Acme');
    expect(r.stdout).toContain('Beta Inc');
    expect(r.stdout).toContain('无来源');
    const json = await cp(['list', '--json'], ok([ACME]));
    expect(JSON.parse(json.stdout)[0].name).toBe('Acme');
  });

  it('an empty product says so; no product id is refused before any request', async () => {
    expect((await cp(['list'], ok([]))).stdout).toContain('没有竞品');
    delete process.env.GOOD7OB_PRODUCT_ID;
    const r = await runCli(registerCompetitorCommands, ['competitor', 'list']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('缺少产品 ID');
    expect(noHttpCalls(r)).toBe(true);
  });

  it('show (alias get) finds a competitor by name, ignoring case and spaces, or by id', async () => {
    const table = routes({ [`GET ${P}/competitors`]: ok([ACME, BETA]) });
    const byName = await cp(['show', 'beta inc'], table);
    expect(byName.stdout).toContain('Beta Inc');
    const byId = await cp(['get', '9'], table);
    expect(byId.stdout).toContain('一句话定位: 定位');
    const missing = await cp(['show', '99'], table);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('没有竞品 99');
    const unknown = await cp(['show', 'Nope'], table);
    expect(unknown.stderr).toContain('找不到 竞品 「Nope」');
  });

  it('add posts the trimmed fields; a bad link / level / empty name never reaches the server', async () => {
    const r = await cp(['add', '--name', ' Acme ', '--positioning', 'p', '--target-users', 'u', '--pricing', '$', '--website', 'https://a.example', '--threat', 'low', '--note', 'n'],
      routes({ [`POST ${P}/competitors`]: ok({ ...ACME, id: 11 }) }));
    expect(r.http.post).toHaveBeenCalledWith(`${P}/competitors`, { name: 'Acme', positioning: 'p', targetUsers: 'u', pricing: '$', websiteUrl: 'https://a.example', threatLevel: 'LOW', note: 'n' });
    expect(r.stdout).toContain('#11');
    for (const bad of [['--website', 'ftp://x'], ['--threat', 'EXTREME'], ['--name', ' ']]) {
      const failed = await cp(['add', '--name', 'X', ...bad]);
      expect(failed.exitCode).toBe(1);
      expect(failed.stderr).toContain('参数错误');
      expect(noHttpCalls(failed)).toBe(true);
    }
  });

  it('a duplicate name shows the readable 15101 message', async () => {
    const r = await cp(['add', '--name', 'Acme'], routes({ [`POST ${P}/competitors`]: bizError(15101, '重名') }));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('已有同名竞品');
    expect(r.stderr).toContain('15101');
  });

  it('update reads the competitor, merges, and PUTs every field with the version read', async () => {
    const r = await cp(['update', 'Acme', '--threat', 'medium'], routes({ [`GET ${P}/competitors`]: ok([ACME]), [`PUT ${P}/competitors/9`]: ok({ ...ACME, version: 4 }) }));
    expect(r.http.put).toHaveBeenCalledWith(`${P}/competitors/9`, {
      name: 'Acme', positioning: '定位', targetUsers: '中小企业', pricing: '按席位', websiteUrl: 'https://acme.example', threatLevel: 'MEDIUM', note: '原备注', version: 3,
    });
    expect(r.stdout).toContain('v4');
  });

  it('update --clear empties exactly the named fields; a flag and its clear conflict; nothing to change is refused', async () => {
    const table = routes({ [`GET ${P}/competitors`]: ok([ACME]), [`PUT ${P}/competitors/9`]: ok(ACME) });
    const r = await cp(['update', '9', '--clear', 'note,website'], table);
    expect(r.http.put).toHaveBeenCalledWith(`${P}/competitors/9`, expect.objectContaining({ note: null, websiteUrl: null, pricing: '按席位', version: 3 }));
    const conflict = await cp(['update', '9', '--note', 'x', '--clear', 'note'], table);
    expect(conflict.stderr).toContain('不能同时使用');
    const none = await cp(['update', '9'], table);
    expect(none.stderr).toContain('没有要修改的内容');
    const unknownField = await cp(['update', '9', '--clear', 'name'], table);
    expect(unknownField.stderr).toContain('--clear 取值无效');
  });

  it('a version conflict (15108) tells you to run it again and nothing else was written', async () => {
    const r = await cp(['update', '9', '--note', 'x'], routes({ [`GET ${P}/competitors`]: ok([ACME]), [`PUT ${P}/competitors/9`]: bizError(15108, '已被他人修改') }));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('请重新执行命令');
    expect(r.stderr).toContain('15108');
  });

  it('delete resolves the name and calls the delete endpoint', async () => {
    const r = await cp(['delete', 'Acme'], routes({ [`GET ${P}/competitors`]: ok([ACME]) }));
    expect(r.http.delete).toHaveBeenCalledWith(`${P}/competitors/9`, undefined);
    expect(r.stdout).toContain('竞品已删除');
  });

  it('a person without edit rights gets the 2000 hint', async () => {
    const r = await cp(['add', '--name', 'X'], routes({ [`POST ${P}/competitors`]: bizError(2000, '无权') }));
    expect(r.stderr).toContain('owner/admin');
    expect(r.stderr).toContain('竞品分析模块');
  });
});

describe('capabilities', () => {
  it('list shows where each row comes from', async () => {
    const r = await cp(['capability', 'list'], routes({ [`GET ${P}/competitor-capabilities`]: ok([EXPORT, { ...CUSTOM, refType: 'USE_CASE', refId: 5, refDeleted: true }, { id: 23, name: '自定义' }]) }));
    expect(r.stdout).toContain('FP#301');
    expect(r.stdout).toContain('原对象已删除');
    expect(r.stdout).toContain('自定义');
  });

  it('add resolves FP / FE / use-case codes through the candidate search, takes ids as they are, and posts one batch', async () => {
    const candidates = ok([
      { refType: 'FP', refId: 301, name: '导出报表', code: 'fun-rep-0001' }, { refType: 'FP', refId: 302, name: '近似', code: 'fun-rep-00011' },
      { refType: 'FE', refId: 12, name: '报表', code: 'fe-rep-0001' }, { refType: 'USE_CASE', refId: 88, name: '邀请成员', code: 'UC-3' },
    ]);
    const r = await cp(['capability', 'add', '--fp', 'FUN-REP-0001,305', '--use-case', 'UC-3,9', '--fe', 'fe-rep-0001', '--name', '私有部署', '--name', 'SSO', '--note', '备注'],
      routes({ [`GET ${P}/competitor-candidates`]: candidates, [`POST ${P}/competitor-capabilities`]: ok({ added: [{ id: 1, name: '导出报表' }], skipped: [{ name: 'SSO', reason: '已存在' }] }) }));
    expect(r.http.get).toHaveBeenCalledWith(`${P}/competitor-candidates`, { params: { type: 'FP', keyword: 'FUN-REP-0001', limit: 50 } });
    expect(r.http.get).toHaveBeenCalledWith(`${P}/competitor-candidates`, { params: { type: 'USE_CASE', keyword: 'UC-3', limit: 50 } });
    expect(r.http.post).toHaveBeenCalledTimes(1);
    expect(r.http.post.mock.calls[0][1].items).toEqual([
      { refType: 'FE', refId: 12, note: '备注' }, { refType: 'FP', refId: 301, note: '备注' }, { refType: 'FP', refId: 305, note: '备注' },
      { refType: 'USE_CASE', refId: 88, note: '备注' }, { refType: 'USE_CASE', refId: 9, note: '备注' },
      { name: '私有部署', note: '备注' }, { name: 'SSO', note: '备注' },
    ]);
    expect(r.stdout).toContain('已添加 1 项');
    expect(r.stdout).toContain('跳过 SSO: 已存在');
  });

  it('add refuses a code that is not a candidate, no source at all, and more than 100 rows, before posting', async () => {
    const unknown = await cp(['capability', 'add', '--fp', 'fun-none-0001'], routes({ [`GET ${P}/competitor-candidates`]: ok([]) }));
    expect(unknown.stderr).toContain('找不到编号为 fun-none-0001');
    expect(unknown.http.post).not.toHaveBeenCalled();
    const nothing = await cp(['capability', 'add']);
    expect(nothing.stderr).toContain('至少给一个来源');
    const many = await cp(['capability', 'add', '--fp', Array.from({ length: 101 }, (_, i) => i + 1).join(',')]);
    expect(many.stderr).toContain('一次最多添加 100 项');
    expect(noHttpCalls(many)).toBe(true);
  });

  it('a duplicate / over-limit / foreign reference shows the readable message', async () => {
    for (const [code, text] of [[15104, '已经是矩阵里的一行'], [15105, '上限 100'], [15114, '不属于这个产品']] as const) {
      const r = await cp(['capability', 'add', '--name', 'x'], routes({ [`POST ${P}/competitor-capabilities`]: bizError(code) }));
      expect(r.stderr).toContain(text);
    }
  });

  it('update keeps the note you did not mention, and clears it only with --clear-note', async () => {
    const table = routes({ [`GET ${P}/competitor-capabilities`]: ok([EXPORT, CUSTOM]), [`PUT ${P}/competitor-capabilities/22`]: ok(CUSTOM) });
    const rename = await cp(['capability', 'update', '私有部署', '--name', '本地部署'], table);
    expect(rename.http.put).toHaveBeenCalledWith(`${P}/competitor-capabilities/22`, { name: '本地部署', note: null });
    const keep = await cp(['capability', 'update', '21', '--name', '导出报表'], table);
    expect(keep.http.put).toHaveBeenCalledWith(`${P}/competitor-capabilities/21`, { name: '导出报表', note: '原说明' });
    const clear = await cp(['capability', 'update', '21', '--clear-note'], table);
    expect(clear.http.put).toHaveBeenCalledWith(`${P}/competitor-capabilities/21`, { name: undefined, note: null });
    expect((await cp(['capability', 'update', '21', '--note', 'x', '--clear-note'], table)).stderr).toContain('不能同时使用');
    expect((await cp(['capability', 'update', '21'], table)).stderr).toContain('没有要修改的内容');
  });

  it('delete resolves the name', async () => {
    const r = await cp(['capability', 'delete', '私有部署'], routes({ [`GET ${P}/competitor-capabilities`]: ok([EXPORT, CUSTOM]) }));
    expect(r.http.delete).toHaveBeenCalledWith(`${P}/competitor-capabilities/22`, undefined);
  });
});

describe('matrix and cells', () => {
  it('matrix renders our column and every competitor, marks AI cells and flags, and --json carries the whole body', async () => {
    const r = await cp(['matrix'], routes({ [`GET ${P}/competitor-matrix`]: ok(MATRIX) }));
    expect(r.stdout).toContain('本产品');
    expect(r.stdout).toContain('Acme');
    expect(r.stdout).toContain('Beta Inc');
    expect(r.stdout).toContain('✓ 有');
    expect(r.stdout).toContain('✗ 无 (AI) *');
    expect(r.stdout).toContain('? 未知');
    expect(r.stdout).toContain('可编辑');
    const json = await cp(['matrix', '--json'], ok(MATRIX));
    expect(JSON.parse(json.stdout).cells).toHaveLength(2);
    expect((await cp(['matrix'], ok({ competitors: [], capabilities: [], cells: [] }))).stdout).toContain('capability add');
  });

  it('cell set on a cell with a record sends its version and keeps its note; competitor and row by name', async () => {
    const r = await cp(['cell', 'set', '导出报表', '--competitor', 'acme', '--value', 'partial'],
      routes({ [`GET ${P}/competitor-matrix`]: ok(MATRIX), [`PUT ${P}/competitor-matrix/cells`]: ok({ ...ACME_CELL, value: 'PARTIAL', fillMode: 'MANUAL', humanTouched: true, version: 5 }) }));
    expect(r.http.put).toHaveBeenCalledWith(`${P}/competitor-matrix/cells`, { capabilityId: 21, competitorId: 9, value: 'PARTIAL', note: '没有', version: 4 });
    expect(r.stdout).toContain('已写入');
  });

  it('cell set on a cell without a record creates it: no version; our own column when --competitor is left out', async () => {
    const r = await cp(['cell', 'set', '22', '--value', 'no', '--note', ' 暂无 '],
      routes({ [`GET ${P}/competitor-matrix`]: ok(MATRIX), [`PUT ${P}/competitor-matrix/cells`]: ok({ ...OWN_CELL, capabilityId: 22 }) }));
    expect(r.http.put).toHaveBeenCalledWith(`${P}/competitor-matrix/cells`, { capabilityId: 22, competitorId: null, value: 'NO', note: '暂无', version: undefined });
    const cleared = await cp(['cell', 'set', '21', '--value', 'yes', '--clear-note'], routes({ [`GET ${P}/competitor-matrix`]: ok(MATRIX), [`PUT ${P}/competitor-matrix/cells`]: ok(OWN_CELL) }));
    expect(cleared.http.put).toHaveBeenCalledWith(`${P}/competitor-matrix/cells`, { capabilityId: 21, competitorId: null, value: 'YES', note: null, version: 2 });
  });

  it('cell set rejects a bad value or an unknown row / competitor before writing', async () => {
    const table = routes({ [`GET ${P}/competitor-matrix`]: ok(MATRIX) });
    expect((await cp(['cell', 'set', '21', '--value', 'maybe'], table)).stderr).toContain('--value 取值无效');
    expect((await cp(['cell', 'set', '不存在的行', '--value', 'yes'], table)).stderr).toContain('找不到 能力项');
    expect((await cp(['cell', 'set', '21', '--competitor', 'Gamma', '--value', 'yes'], table)).stderr).toContain('找不到 竞品');
    expect((await cp(['cell', 'set', '21'], table)).exitCode).toBe(1);
  });

  it('cell set conflict (15108) is explained and says nothing was written', async () => {
    const r = await cp(['cell', 'set', '21', '--value', 'yes'], routes({ [`GET ${P}/competitor-matrix`]: ok(MATRIX), [`PUT ${P}/competitor-matrix/cells`]: bizError(15108) }));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('没有写入任何内容');
  });

  it('cell confirm sends the version read; refuses a cell that is not waiting for confirmation', async () => {
    const table = routes({ [`GET ${P}/competitor-matrix`]: ok(MATRIX), [`POST ${P}/competitor-matrix/cells/confirm`]: ok({ ...ACME_CELL, fillMode: 'MANUAL', humanTouched: true, version: 5 }) });
    const r = await cp(['cell', 'confirm', '导出报表', '--competitor', 'Acme'], table);
    expect(r.http.post).toHaveBeenCalledWith(`${P}/competitor-matrix/cells/confirm`, { capabilityId: 21, competitorId: 9, version: 4 });
    expect(r.stdout).toContain('已确认');
    const own = await cp(['cell', 'confirm', '21'], table);
    expect(own.stderr).toContain('不是待确认的 AI 填写');
    const none = await cp(['cell', 'confirm', '22'], table);
    expect(none.stderr).toContain('还没有记录');
    expect(none.http.post).not.toHaveBeenCalled();
  });
});

describe('sources', () => {
  it('add to a competitor, and to a cell (with a competitor, or our own), with today (JST) as the default check date', async () => {
    const table = routes({ [`GET ${P}/competitors`]: ok([ACME]), [`GET ${P}/competitor-capabilities`]: ok([EXPORT]), [`POST ${P}/competitor-sources`]: ok({ source: { id: 1, title: '官网' } }) });
    const forCompetitor = await cp(['source', 'add', '--competitor', 'Acme', '--title', ' 官网 ', '--url', 'https://acme.example', '--credibility', 'primary', '--verified-on', '2026-11-01'], table);
    expect(forCompetitor.http.post).toHaveBeenCalledWith(`${P}/competitor-sources`, { targetType: 'COMPETITOR', competitorId: 9, capabilityId: undefined, title: '官网', url: 'https://acme.example', credibility: 'PRIMARY', verifiedOn: '2026-11-01' });
    const forCell = await cp(['source', 'add', '--capability', '导出报表', '--competitor', '9', '--title', 't', '--credibility', 'secondary'], table);
    expect(forCell.http.post).toHaveBeenCalledWith(`${P}/competitor-sources`, expect.objectContaining({ targetType: 'CELL', competitorId: 9, capabilityId: 21, url: null, verifiedOn: todayJst() }));
    const own = await cp(['source', 'add', '--capability', '21', '--title', 't', '--credibility', 'unverified'], table);
    expect(own.http.post).toHaveBeenCalledWith(`${P}/competitor-sources`, expect.objectContaining({ targetType: 'CELL', competitorId: undefined, capabilityId: 21 }));
  });

  it('add refuses a missing target, a bad link / credibility / date before any request', async () => {
    for (const args of [['--title', 't', '--credibility', 'primary'], ['--competitor', '9', '--title', 't', '--credibility', 'primary', '--url', 'javascript:alert(1)'],
      ['--competitor', '9', '--title', 't', '--credibility', 'great'], ['--competitor', '9', '--title', 't', '--credibility', 'primary', '--verified-on', '2026-02-30'],
      ['--competitor', '9', '--title', 't']]) {
      const r = await cp(['source', 'add', ...args]);
      expect(r.exitCode).toBe(1);
      expect(noHttpCalls(r)).toBe(true);
    }
  });

  it('too many sources / future date / bad link from the server read well', async () => {
    for (const [code, text] of [[15106, '已达 5 条'], [15107, '不得晚于今天'], [15103, 'http']] as const) {
      const r = await cp(['source', 'add', '--competitor', '9', '--title', 't', '--credibility', 'primary'], routes({ [`POST ${P}/competitor-sources`]: bizError(code) }));
      expect(r.stderr).toContain(text);
    }
  });

  it('update finds the source by id in the matrix cells, merges and sends the version read', async () => {
    const r = await cp(['source', 'update', '55', '--credibility', 'secondary'],
      routes({ [`GET ${P}/competitor-matrix`]: ok(MATRIX), [`PUT ${P}/competitor-sources/55`]: ok({ source: { id: 55, title: '官网定价页', version: 7 } }) }));
    expect(r.http.put).toHaveBeenCalledWith(`${P}/competitor-sources/55`, { title: '官网定价页', url: 'https://acme.example/p', credibility: 'SECONDARY', verifiedOn: '2026-10-30', version: 6 });
    expect(r.stdout).toContain('v7');
  });

  it('update falls back to each competitor\'s own sources; an unknown id is reported', async () => {
    const own = { id: 70, title: '融资新闻', url: null, credibility: 'SECONDARY', verifiedOn: '2026-10-01', version: 2 };
    const table = routes({ [`GET ${P}/competitor-matrix`]: ok({ ...MATRIX, cells: [] }), [`GET ${P}/competitor-sources`]: ok([own]), [`PUT ${P}/competitor-sources/70`]: ok({ source: { id: 70, title: 't', version: 3 } }) });
    const r = await cp(['source', 'update', '70', '--title', '融资公告'], table);
    expect(r.http.put).toHaveBeenCalledWith(`${P}/competitor-sources/70`, { title: '融资公告', url: null, credibility: 'SECONDARY', verifiedOn: '2026-10-01', version: 2 });
    const missing = await cp(['source', 'update', '99', '--title', 'x'], routes({ [`GET ${P}/competitor-matrix`]: ok({ ...MATRIX, cells: [] }), [`GET ${P}/competitor-sources`]: ok([]) }));
    expect(missing.stderr).toContain('没有来源 #99');
    expect((await cp(['source', 'update', '70'], table)).stderr).toContain('没有要修改的内容');
  });

  it('list needs a target; delete calls the endpoint', async () => {
    expect((await cp(['source', 'list'])).stderr).toContain('要给来源指定挂在哪');
    const r = await cp(['source', 'list', '--competitor', '9'], ok([{ id: 1, title: '官网', credibility: 'PRIMARY', verifiedOn: '2026-11-01', url: 'https://a' }]));
    expect(r.http.get).toHaveBeenCalledWith(`${P}/competitor-sources`, { params: { targetType: 'COMPETITOR', competitorId: 9, capabilityId: undefined } });
    expect(r.stdout).toContain('一手');
    const d = await cp(['source', 'delete', '55']);
    expect(d.http.delete).toHaveBeenCalledWith(`${P}/competitor-sources/55`, undefined);
  });
});

describe('opportunities', () => {
  it('list passes the filters and shows the idea an opportunity became', async () => {
    const converted = { ...OPP, id: 8, status: 'CONVERTED', idea: { id: 30, title: '导出想法', status: 'evaluating' } };
    const r = await cp(['opportunity', 'list', '--kind', 'gap', '--status', 'converted'], ok([OPP, converted]));
    expect(r.http.get).toHaveBeenCalledWith(`${P}/competitor-opportunities`, { params: { kind: 'GAP', status: 'CONVERTED' } });
    expect(r.stdout).toContain('差距');
    expect(r.stdout).toContain('#30 导出想法');
    expect((await cp(['opportunity', 'list', '--status', 'done'])).stderr).toContain('--status 取值无效');
  });

  it('create resolves the row and the competitors by name', async () => {
    const r = await cp(['opportunity', 'create', '--kind', 'opportunity', '--title', ' 做差异化 ', '--description', 'd', '--capability', '导出报表', '--competitor', 'Acme,10'],
      routes({ [`GET ${P}/competitor-capabilities`]: ok([EXPORT]), [`GET ${P}/competitors`]: ok([ACME, BETA]), [`POST ${P}/competitor-opportunities`]: ok(OPP) }));
    expect(r.http.post).toHaveBeenCalledWith(`${P}/competitor-opportunities`, { kind: 'OPPORTUNITY', title: '做差异化', description: 'd', capabilityId: 21, competitorIds: [9, 10] });
    const bad = await cp(['opportunity', 'create', '--kind', 'idea', '--title', 't']);
    expect(bad.stderr).toContain('--kind 取值无效');
    expect(bad.http.post).not.toHaveBeenCalled();
  });

  it('update merges with the current one: links, row, description and version are kept unless named or cleared', async () => {
    const table = routes({ [`GET ${P}/competitor-opportunities`]: ok([OPP]), [`PUT ${P}/competitor-opportunities/7`]: ok({ ...OPP, version: 6 }) });
    const r = await cp(['opportunity', 'update', '7', '--status', 'ignored'], table);
    expect(r.http.put).toHaveBeenCalledWith(`${P}/competitor-opportunities/7`, { kind: 'GAP', title: '补齐导出', description: '原说明', capabilityId: 21, competitorIds: [9], status: 'IGNORED', version: 5 });
    const cleared = await cp(['opportunity', 'update', '7', '--clear', 'description,capability,competitors'], table);
    expect(cleared.http.put).toHaveBeenCalledWith(`${P}/competitor-opportunities/7`, { kind: 'GAP', title: '补齐导出', description: null, capabilityId: null, competitorIds: [], status: undefined, version: 5 });
    expect((await cp(['opportunity', 'update', '7', '--status', 'converted'], table)).stderr).toContain('--status 取值无效');
    expect((await cp(['opportunity', 'update', '7', '--description', 'x', '--clear', 'description'], table)).stderr).toContain('不能同时使用');
    expect((await cp(['opportunity', 'update', '99', '--title', 'x'], table)).stderr).toContain('没有机会点 #99');
  });

  it('a locked status (15110) and a conflict (15108) are explained', async () => {
    const get = { [`GET ${P}/competitor-opportunities`]: ok([OPP]) };
    expect((await cp(['opportunity', 'update', '7', '--status', 'ignored'], routes({ ...get, [`PUT ${P}/competitor-opportunities/7`]: bizError(15110) }))).stderr).toContain('不能手动改状态');
    expect((await cp(['opportunity', 'update', '7', '--title', 'x'], routes({ ...get, [`PUT ${P}/competitor-opportunities/7`]: bizError(15108) }))).stderr).toContain('请重新执行命令');
  });

  it('delete and generate', async () => {
    expect((await cp(['opportunity', 'delete', '7'])).http.delete).toHaveBeenCalledWith(`${P}/competitor-opportunities/7`, undefined);
    const g = await cp(['opportunity', 'generate'], ok({ created: 2, skipped: 1, items: [OPP] }));
    expect(g.http.post).toHaveBeenCalledWith(`${P}/competitor-opportunities/generate`, undefined);
    expect(g.stdout).toContain('新增 2 条，跳过 1 条');
  });

  it('convert defaults to a check and shows the similar ideas with the next commands; nothing is created', async () => {
    const similar = { converted: false, similarIdeas: [{ id: 30, title: '导出想法', status: 'rejected', rejectReason: '重复', similarity: 0.86 }] };
    const r = await cp(['opportunity', 'convert', '7'], ok(similar));
    expect(r.http.post).toHaveBeenCalledWith(`${P}/competitor-opportunities/7/convert-to-idea`, { mode: 'CHECK', linkIdeaId: undefined });
    expect(r.stdout).toContain('#30 导出想法');
    expect(r.stdout).toContain('86%');
    expect(r.stdout).toContain('--mode create');
    expect(r.stdout).toContain('--mode link --idea');
  });

  it('convert --mode create / link, an already converted one, and the errors', async () => {
    const created = await cp(['opportunity', 'convert', '7', '--mode', 'create'], ok({ converted: true, idea: { id: 31, title: '补齐导出', status: 'evaluating' }, opportunity: { id: 7, status: 'CONVERTED', version: 6 } }));
    expect(created.http.post).toHaveBeenCalledWith(expect.any(String), { mode: 'CREATE', linkIdeaId: undefined });
    expect(created.stdout).toContain('已转为想法 #31');
    const linked = await cp(['opportunity', 'convert', '7', '--mode', 'link', '--idea', '30'], ok({ converted: true, idea: { id: 30, title: 'x', status: 'evaluating' } }));
    expect(linked.http.post).toHaveBeenCalledWith(expect.any(String), { mode: 'LINK', linkIdeaId: 30 });
    expect((await cp(['opportunity', 'convert', '7'], ok({ alreadyConverted: true, idea: { id: 31, title: 'x', status: 'evaluating' } }))).stdout).toContain('已转为想法 #31');
    expect((await cp(['opportunity', 'convert', '7', '--mode', 'link'])).stderr).toContain('--idea');
    expect((await cp(['opportunity', 'convert', '7', '--idea', '30'])).stderr).toContain('只能与 --mode link');
    expect((await cp(['opportunity', 'convert', '7', '--mode', 'merge'])).stderr).toContain('--mode 取值无效');
    for (const [code, text] of [[15111, '想法字段的长度'], [15112, '不属于这个产品'], [15113, '待处理']] as const) {
      expect((await cp(['opportunity', 'convert', '7', '--mode', 'create'], routes({ [`POST ${P}/competitor-opportunities/7/convert-to-idea`]: bizError(code) }))).stderr).toContain(text);
    }
  });
});

describe('ai-fill', () => {
  it('posts with the long AI timeout and renders the summary', async () => {
    const r = await cp(['ai-fill'], ok({ succeeded: 12, failed: 1, skipped: 7, model: 'claude-sonnet-5-5', tokenUsage: { inputTokens: 5200, outputTokens: 900 }, results: [{ capabilityId: 22, status: 'FAILED', reason: 'MODEL_OUTPUT_INVALID' }] }));
    expect(r.http.post).toHaveBeenCalledWith(`${P}/competitor-matrix/ai-fill`, undefined, { timeout: 180000 });
    expect(r.stdout).toContain('成功 12');
    expect(r.stdout).toContain('MODEL_OUTPUT_INVALID');
    expect(r.stdout).toContain('competitor cell confirm');
  });

  it('before the server is ready (15115) it says so and points at cell set; no balance (4015) and no permission (2000) are explained', async () => {
    expect((await cp(['ai-fill'], bizError(15115))).stderr).toContain('competitor cell set');
    expect((await cp(['ai-fill'], bizError(4015))).stderr).toContain('没有扣费');
    expect((await cp(['ai-fill'], bizError(2000))).stderr).toContain('AI 填写只能由用户本人触发');
  });

  it('a gateway timeout warns against re-triggering blindly', async () => {
    const r = await runCli(registerCompetitorCommands, ['competitor', 'ai-fill', '--product', '7'], () => { throw new Error('timeout of 180000ms exceeded'); });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('不要立刻重复触发');
  });
});

describe('error codes', () => {
  it('every competitor code 15101-15115 and the shared 1000 / 1001 / 1002 / 2000 / 4015 have a readable message', () => {
    for (let code = 15101; code <= 15115; code++) expect(CODES[code], String(code)).toBeTruthy();
    for (const code of [1000, 1001, 1002, 2000, 4015]) expect(CODES[code], String(code)).toBeTruthy();
  });
});
