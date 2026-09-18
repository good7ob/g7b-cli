/**
 * Tests for `good7ob prd import-structure` — parser, mapping, planner.
 */

import { describe, expect, it } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildDesired, clip, fpStatusFor, loadStructure, mapFpType, mapRpType, parseIndex, parsePrd,
  parseVerified, rpImplStatusFor, summarize, syncStructure,
} from '../structure';

const INDEX = `
| 子模块 ID | 子模块 | 需求 ID | 需求描述 | 状态 | PRD |
|---|---|---|---|---|---|
| MOD-01-SUB-01 | 账户认证 | fun-user-auth-0001 | 邮箱/密码登录 | DONE | [→](./user/prd-0004.md) |
| MOD-01-SUB-01 | 账户认证 | fun-user-auth-0002 | 手机验证码登录 | IN_PROGRESS | [→](./user/prd-0004.md) |
| MOD-02-SUB-03 | 支付 | fun-pay-0001 | 含 a \\| b 的描述 | SKIP | [→](./pay/x.md) |
| MOD-02-SUB-03 | 支付 | fun-pay-0002 | 退款 | TODO | [→](./pay/x.md) |
`;

const PRD = `
## Function Points 一览

| FP ID | 名称 | 类型 | RP 数 | 复杂度 | 权重 | 估算工时 | 状态 |
|---|---|---|---|---|---|---|---|
| \`fun-user-auth-0001\` | 邮箱密码登录 | Integration | 2 | M | 3 | 16.5h | TODO |
| \`fun-user-auth-0002\` | 手机验证码登录 | Bogus | 1 | L | 5 | 27.5h | TODO |

## FP-1 · 邮箱密码登录

**FP ID**：\`fun-user-auth-0001\`

| RP ID | 规则 | 类型 | 复杂度 |
|---|---|---|:--:|
| \`rp-user-auth-0001\` | 密码以 \`MD5\` 存储 | Security | 3 |
| \`rp-user-auth-0002\` | 返回 a \\| b | Report | 1 |
| | | **Σ RP Score** | **4** |

## FP-2 · 手机验证码登录

**FP ID**：\`fun-user-auth-0002\`

| \`rp-user-auth-0003\` | 验证码 4 位 | Input/Output | 1 |

## API 契约

| \`fun-user-auth-0001\` | POST | \`/user/auth/login/email\` | 邮箱密码登录 |
`;

describe('parseIndex', () => {
  it('reads every requirement row, keeping pipes inside the description', () => {
    const rows = parseIndex(INDEX);
    expect(rows.map((r) => [r.featureId, r.funId, r.status])).toEqual([
      ['MOD-01-SUB-01', 'fun-user-auth-0001', 'DONE'],
      ['MOD-01-SUB-01', 'fun-user-auth-0002', 'IN_PROGRESS'],
      ['MOD-02-SUB-03', 'fun-pay-0001', 'SKIP'],
      ['MOD-02-SUB-03', 'fun-pay-0002', 'TODO'],
    ]);
    expect(rows[0]).toMatchObject({ featureName: '账户认证', desc: '邮箱/密码登录', prdLink: './user/prd-0004.md' });
    expect(rows[2].desc).toBe('含 a | b 的描述');
  });
});

describe('parsePrd', () => {
  it('assigns RP rows to their FP section and takes fpType from the summary table only', () => {
    const fps = parsePrd(PRD);
    expect(fps).toEqual([
      {
        funId: 'fun-user-auth-0001', fpType: 'Integration', rps: [
          { rpId: 'rp-user-auth-0001', text: '密码以 `MD5` 存储', type: 'Security' },
          { rpId: 'rp-user-auth-0002', text: '返回 a | b', type: 'Report' },
        ],
      },
      { funId: 'fun-user-auth-0002', fpType: 'Bogus', rps: [{ rpId: 'rp-user-auth-0003', text: '验证码 4 位', type: 'Input/Output' }] },
    ]);
  });
});

describe('mapping', () => {
  it('maps types onto backend enums', () => {
    expect(mapFpType('Integration')).toBe('Integration');
    expect(mapFpType('Bogus')).toBe('Other');
    expect(mapFpType(undefined)).toBe('Other');
    expect(mapRpType('Business Rule')).toBe('Business Rule');
    expect(mapRpType('Report')).toBe('Output');
    expect(mapRpType('Query')).toBe('Output');
    expect(mapRpType('Input/Output')).toBe('Input');
    expect(mapRpType('Whatever')).toBe('Other');
  });

  it('prefers verified FP status over the index', () => {
    const v = parseVerified({ fpStatus: { 'fun-a': 'DONE', 'fun-b': 'PARTIAL', 'fun-c': 'TODO' }, rpImplStatus: { 'rp-x': 'UNVERIFIED' } });
    expect(fpStatusFor('fun-a', 'TODO', v)).toBe('Completed');
    expect(fpStatusFor('fun-b', 'DONE', v)).toBe('In Progress');
    expect(fpStatusFor('fun-c', 'DONE', v)).toBe('Ready');
    expect(['DONE', 'IN_PROGRESS', 'TODO', 'SKIP'].map((s) => fpStatusFor('fun-z', s as any, v)))
      .toEqual(['Completed', 'In Progress', 'Draft', 'On Hold']);
    expect(rpImplStatusFor('fun-a', 'rp-x', v)).toBe('UNVERIFIED');
    expect(rpImplStatusFor('fun-a', 'rp-y', v)).toBe('DONE');
    expect(rpImplStatusFor('fun-z', 'rp-y', v)).toBe('TODO');
    expect(rpImplStatusFor('fun-a', 'rp-y', undefined)).toBe('TODO');
  });

  it('rejects malformed verified JSON with a clear message', () => {
    expect(() => parseVerified([])).toThrow('--verified');
    expect(() => parseVerified({})).toThrow('fpStatus');
    expect(() => parseVerified({ fpStatus: { 'fun-a': 'MAYBE' } })).toThrow('fun-a');
    expect(() => parseVerified({ fpStatus: {}, rpImplStatus: { 'rp-a': 'NOPE' } })).toThrow('rp-a');
  });

  it('clips long names but keeps the id prefix', () => {
    const long = `fun-x-0001 ${'长'.repeat(200)}`;
    const c = clip(long, 100);
    expect(c.length).toBeLessThanOrEqual(100);
    expect(c.startsWith('fun-x-0001 ')).toBe(true);
    expect(clip('short', 100)).toBe('short');
  });
});

function fixtureDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-prd-'));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write('prd-0000-good7ob-requirement-index.md', INDEX);
  write('user/prd-0004.md', PRD);
  write('_templates/prd-template.md', PRD.replace(/user-auth/g, 'tpl'));
  write('三层结构改造方案.md', PRD.replace(/user-auth/g, 'plan'));
  return dir;
}

describe('loadStructure + buildDesired', () => {
  it('builds Feature → FP → RP names, types and statuses, ignoring templates', () => {
    const { features, warnings } = buildDesired(loadStructure(fixtureDir()),
      parseVerified({ fpStatus: { 'fun-user-auth-0001': 'DONE' }, rpImplStatus: { 'rp-user-auth-0002': 'TODO' } }));
    expect(warnings).toEqual([]);
    expect(features.map((f) => [f.key, f.name, f.fps.length])).toEqual([
      ['MOD-01-SUB-01', 'MOD-01-SUB-01 账户认证', 2],
      ['MOD-02-SUB-03', 'MOD-02-SUB-03 支付', 2],
    ]);
    const [fp1, fp2] = features[0].fps;
    expect(fp1).toMatchObject({ key: 'fun-user-auth-0001', name: 'fun-user-auth-0001 邮箱/密码登录', fpType: 'Integration', status: 'Completed' });
    expect(fp1.rps).toEqual([
      { key: 'rp-user-auth-0001', statement: 'rp-user-auth-0001 密码以 `MD5` 存储', rpType: 'Security', implStatus: 'DONE' },
      { key: 'rp-user-auth-0002', statement: 'rp-user-auth-0002 返回 a | b', rpType: 'Output', implStatus: 'TODO' },
    ]);
    expect(fp2).toMatchObject({ fpType: 'Other', status: 'In Progress' });
    expect(fp2.rps[0]).toMatchObject({ rpType: 'Input', implStatus: 'TODO' });
    expect(features[1].fps.map((f) => [f.fpType, f.status, f.rps.length])).toEqual([['Other', 'On Hold', 0], ['Other', 'Draft', 0]]);
    expect(summarize(features)).toEqual({
      features: 2, fps: 4, rps: 3,
      fpStatus: { Completed: 1, 'In Progress': 1, 'On Hold': 1, Draft: 1 },
      rpImplStatus: { DONE: 1, TODO: 2 },
    });
  });

  it('warns about PRD FPs missing from the index', () => {
    const parsed = loadStructure(fixtureDir());
    const { warnings } = buildDesired({ ...parsed, rows: parsed.rows.filter((r) => r.funId !== 'fun-user-auth-0002') });
    expect(warnings.join('\n')).toContain('fun-user-auth-0002');
  });
});

/** In-memory stand-in for the three forge structuring controllers. */
function fakeBackend() {
  let seq = 100;
  const db = { features: [] as any[], fps: [] as any[], rps: [] as any[] };
  const writes: string[] = [];
  const client = {
    async get(url: string, params: any) {
      if (url === '/forge/features') return db.features.filter((f) => f.productId === params.productId);
      if (url === '/forge/function-points') return db.fps.filter((f) => f.featureId === params.featureId);
      if (url === '/forge/rule-points') return db.rps.filter((r) => r.functionPointId === params.functionPointId);
      throw new Error(`unexpected GET ${url}`);
    },
    async post(url: string, body: any) {
      writes.push(`POST ${url}`);
      const row = { id: ++seq, ...body };
      // Mirrors the real backend: forge_feature.tenant_id is NOT NULL, so a create
      // without tenantId blows up with a 系统异常 instead of a validation message.
      if (url === '/forge/features' && !body.tenantId) throw new Error('系统异常，请联系管理员');
      if (url === '/forge/features') db.features.push(row);
      else if (url === '/forge/function-points') db.fps.push({ ...row, status: 'Draft' });
      // Old backend: implStatus is not persisted on create, so the importer must follow up with a PUT.
      else if (url === '/forge/rule-points') { delete row.implStatus; db.rps.push(row); } else throw new Error(`unexpected POST ${url}`);
      return row;
    },
    async put(url: string, body: any) {
      writes.push(`PUT ${url}`);
      const m = url.match(/^\/forge\/(function-points|rule-points)\/(\d+)\/(status|impl-status)$/);
      if (!m) throw new Error(`unexpected PUT ${url}`);
      const row = (m[1] === 'function-points' ? db.fps : db.rps).find((r) => r.id === Number(m[2]));
      Object.assign(row, body);
      return row;
    },
  };
  return { db, writes, client };
}

describe('syncStructure', () => {
  const desired = () => buildDesired(loadStructure(fixtureDir()),
    parseVerified({ fpStatus: { 'fun-user-auth-0001': 'DONE' }, rpImplStatus: { 'rp-user-auth-0002': 'TODO' } })).features;

  it('dry-run against an empty product plans creates and writes nothing', async () => {
    const { client, writes } = fakeBackend();
    const r = await syncStructure(client, 7, desired(), { dryRun: true, concurrency: 2 });
    expect(writes).toEqual([]);
    expect(r.counts).toEqual({
      feature: { create: 2, update: 0, unchanged: 0 },
      fp: { create: 4, update: 0, unchanged: 0 },
      rp: { create: 3, update: 0, unchanged: 0 },
    });
  });

  it('refuses to create Features without a tenantId instead of failing mid-import', async () => {
    const { client, writes } = fakeBackend();
    await expect(syncStructure(client, 7, desired(), { dryRun: false, concurrency: 1 }))
      .rejects.toThrow('--tenant');
    expect(writes).toEqual([]);
  });

  it('creates everything, then a re-run is a no-op, then only changed statuses update', async () => {
    const { client, db, writes } = fakeBackend();
    await syncStructure(client, 7, desired(), { dryRun: false, concurrency: 2, tenantId: 58 });
    expect(db.features.map((f) => f.name).sort()).toEqual(['MOD-01-SUB-01 账户认证', 'MOD-02-SUB-03 支付']);
    expect(db.features.every((f) => f.tenantId === 58)).toBe(true);
    expect(db.fps.find((f) => f.name.startsWith('fun-user-auth-0001'))).toMatchObject({ status: 'Completed', fpType: 'Integration' });
    expect(db.fps.find((f) => f.name.startsWith('fun-pay-0002')).status).toBe('Draft');
    expect(db.rps.map((r) => [r.statement.split(' ')[0], r.implStatus ?? 'TODO']).sort()).toEqual([
      ['rp-user-auth-0001', 'DONE'], ['rp-user-auth-0002', 'TODO'], ['rp-user-auth-0003', 'TODO'],
    ]);

    writes.length = 0;
    const again = await syncStructure(client, 7, desired(), { dryRun: false, concurrency: 2 });
    expect(writes).toEqual([]);
    expect(again.actions).toEqual([]);
    expect(again.counts.rp).toEqual({ create: 0, update: 0, unchanged: 3 });

    // Someone renamed the text part — matching is by id prefix, so still unchanged; flip one status.
    db.rps[0].statement = `${db.rps[0].statement.split(' ')[0]} 改过的文字`;
    const changed = desired();
    changed[0].fps[0].rps[0].implStatus = 'UNVERIFIED';
    changed[0].fps[1].status = 'Completed';
    const upd = await syncStructure(client, 7, changed, { dryRun: false, concurrency: 1 });
    expect(upd.actions).toEqual([
      { layer: 'rp', op: 'update', id: 'rp-user-auth-0001', field: 'implStatus', from: 'DONE', to: 'UNVERIFIED' },
      { layer: 'fp', op: 'update', id: 'fun-user-auth-0002', field: 'status', from: 'In Progress', to: 'Completed' },
    ]);
    expect(writes.filter((w) => w.startsWith('POST'))).toEqual([]);
    expect(db.rps.length).toBe(3);
  });

  it('stops on the first hard error and names the node', async () => {
    const { client } = fakeBackend();
    const failing = { ...client, post: async (url: string, body: any) => {
      if (url === '/forge/function-points' && body.name.startsWith('fun-pay-0001')) throw new Error('FP 类型不合法');
      return client.post(url, body);
    } };
    await expect(syncStructure(failing, 7, desired(), { dryRun: false, concurrency: 1, tenantId: 58 }))
      .rejects.toThrow('fun-pay-0001: FP 类型不合法');
  });
});

describe('prd import-structure CLI', () => {
  it('--parse-only prints counts without an API key or network', () => {
    const out = execSync(`npm run cli -- prd import-structure --parse-only --prd-dir ${fixtureDir()} --json`, {
      env: { ...process.env, GOOD7OB_API_KEY: '', GOOD7OB_API_URL: 'http://127.0.0.1:9' },
    }).toString();
    const json = JSON.parse(out.slice(out.indexOf('{')));
    expect(json.parsed).toMatchObject({ features: 2, fps: 4, rps: 3 });
  });

  it('requires --product unless --parse-only', () => {
    expect(() => execSync(`npm run cli -- prd import-structure --prd-dir ${fixtureDir()}`, { stdio: 'pipe' })).toThrow();
  });
});
