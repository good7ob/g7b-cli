/**
 * Tests for `good7ob prd import-structure` — parser, mapping, planner.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildImportPayloads, summarizePayloads } from '../importPayload';
import { printReport, sendAll } from '../importStructure';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildDesired, clip, fpStatusFor, loadStructure, mapFpType, mapRpType, parseDocVersion, parseIndex, parsePrd,
  parseVerified, rpImplStatusFor, summarize,
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
    expect(fps.map((fp) => [fp.funId, fp.fpType, fp.rps.map((r) => [r.rpId, r.text, r.type])])).toEqual([
      ['fun-user-auth-0001', 'Integration', [['rp-user-auth-0001', '密码以 `MD5` 存储', 'Security'], ['rp-user-auth-0002', '返回 a | b', 'Report']]],
      ['fun-user-auth-0002', 'Bogus', [['rp-user-auth-0003', '验证码 4 位', 'Input/Output']]],
    ]);
    expect(fps[0].line).toBeGreaterThan(0);
    expect(fps[0].rps[0].line).toBeGreaterThan(fps[0].line);
    expect(fps[0].section).toBe('FP-1 · 邮箱密码登录');
  });
});

describe('mapping', () => {
  it('maps types onto backend enums', () => {
    expect(mapFpType('Integration')).toBe('Integration');
    expect(mapFpType('Bogus')).toBeUndefined();
    expect(mapFpType(undefined)).toBeUndefined();
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
    expect(rpImplStatusFor('fun-z', 'rp-y', v)).toBeUndefined();
    expect(rpImplStatusFor('fun-a', 'rp-y', undefined)).toBeUndefined();
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

describe('index file name', () => {
  it('accepts the new name and the legacy name', () => {
    for (const name of ['prd-0000-requirement-index.md', 'prd-0000-good7ob-requirement-index.md']) {
      const dir = fixtureDir();
      fs.renameSync(path.join(dir, 'prd-0000-good7ob-requirement-index.md'), path.join(dir, name));
      expect(loadStructure(dir).rows).toHaveLength(4);
    }
  });
});

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

describe('buildImportPayloads', () => {
  const dirWithVersion = () => {
    const dir = fixtureDir();
    fs.renameSync(path.join(dir, 'user/prd-0004.md'), path.join(dir, 'user/prd-0004-user-auth.md'));
    const md = fs.readFileSync(path.join(dir, 'user/prd-0004-user-auth.md'), 'utf8');
    fs.writeFileSync(path.join(dir, 'user/prd-0004-user-auth.md'),
      `# 用户认证\n\n| 版本 | 日期 | 作者 | 变更 |\n|---|---|---|---|\n| 1.0.0 | 2026-09-01 | PM | 初稿 |\n| 1.0.1 | 2026-09-05 | PM | 修订 |\n\n${md}`);
    return dir;
  };

  it('one body per PRD file: prd number + latest doc version, clean names, line numbers and sections', () => {
    const { payloads, warnings } = buildImportPayloads(loadStructure(dirWithVersion()), { tenantId: 7, productId: 10, tool: 't@1', dryRun: false });
    expect(warnings).toEqual([]);
    expect(payloads).toHaveLength(1);
    const { file, payload } = payloads[0];
    expect(file).toBe('user/prd-0004-user-auth.md');
    expect(payload).toMatchObject({ tenantId: 7, productId: 10, prdNo: 'prd-0004', prdVersion: '1.0.1', tool: 't@1', dryRun: false });
    expect(payload.features.map((f) => [f.code, f.name, f.fps.length])).toEqual([['MOD-01-SUB-01', '账户认证', 2]]);
    const fp = payload.features[0].fps[0];
    expect(fp).toMatchObject({ code: 'fun-user-auth-0001', name: '邮箱/密码登录', fpType: 'Integration', status: 'Completed' });
    expect(fp.line).toBeGreaterThan(0);
    expect(fp.section).toContain('FP-1');
    expect(fp.rps[0]).toMatchObject({ code: 'rp-user-auth-0001', statement: '密码以 `MD5` 存储', rpType: 'Security' });
    expect('implStatus' in fp.rps[0]).toBe(false);
    expect(fp.rps[0].line).toBeGreaterThan(fp.line);
  });

  it('omits fpType when the PRD declares none/unknown (no Other), keeps declared ones', () => {
    const { payloads } = buildImportPayloads(loadStructure(dirWithVersion()), { productId: 10, tool: 't', dryRun: true });
    const [fp1, fp2] = payloads[0].payload.features[0].fps;
    expect(fp1.fpType).toBe('Integration');
    expect('fpType' in fp2).toBe(false);
    expect(JSON.parse(JSON.stringify(payloads[0].payload)).features[0].fps[1]).not.toHaveProperty('fpType');
    expect(JSON.stringify(payloads[0].payload)).not.toContain('implStatus');
  });

  it('passes --verified statuses through and counts what it sends', () => {
    const { payloads } = buildImportPayloads(loadStructure(dirWithVersion()),
      { productId: 10, tool: 't', dryRun: true, verified: parseVerified({ fpStatus: { 'fun-user-auth-0001': 'DONE' }, rpImplStatus: { 'rp-user-auth-0002': 'UNVERIFIED' } }) });
    const fp = payloads[0].payload.features[0].fps[0];
    expect(fp.status).toBe('Completed');
    expect(fp.rps.map((r) => r.implStatus)).toEqual(['DONE', 'UNVERIFIED']);
    expect(summarizePayloads(payloads)).toEqual({ files: 1, features: 1, fps: 2, rps: 3 });
  });

  it('refuses a PRD file without a document version instead of sending an unattributable import', () => {
    expect(() => buildImportPayloads(loadStructure(fixtureDir()), { tenantId: 7, productId: 10, tool: 't', dryRun: false }))
      .toThrow(/文件名里没有 PRD 编号|没有找到文档版本/);
  });
});

describe('sendAll + printReport', () => {
  it('posts every file to the import endpoint and prints a rejection with file:line positions', async () => {
    const calls: any[] = [];
    const client = { async post(url: string, body: any) { calls.push([url, body.prdNo]); return { status: 'REJECTED', errors: [{ layer: 'rp', code: 'rp-a-0001', line: 30, message: '编号重复定义' }], counts: {}, changes: [], completeness: [], notes: [] }; } };
    const out = await sendAll(client, [{ file: 'x/prd-0001-a.md', payload: { prdNo: 'prd-0001', prdVersion: '1.0.0', tool: 't', dryRun: false, features: [] } }]);
    expect(calls).toEqual([['/forge/structuring/import', 'prd-0001']]);
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m: any) => { lines.push(String(m)); });
    printReport(out[0].file, out[0].report);
    spy.mockRestore();
    expect(lines.join('\n')).toContain('x/prd-0001-a.md:30  rp-a-0001  编号重复定义');
  });
});

describe('sync-structure payload and report', () => {
  it('sends confirm only when asked, and prints impacted tasks of a NEEDS_CONFIRMATION answer', () => {
    const parsed = loadStructure((() => {
      const dir = fixtureDir();
      const f = path.join(dir, 'user/prd-0004.md');
      fs.renameSync(f, path.join(dir, 'user/prd-0004-a.md'));
      fs.writeFileSync(path.join(dir, 'user/prd-0004-a.md'), `| 1.0.0 | 2026-09-01 | PM | x |\n${PRD}`);
      return dir;
    })());
    const noConfirm = buildImportPayloads(parsed, { productId: 1, tenantId: 2, tool: 't', dryRun: false });
    const confirm = buildImportPayloads(parsed, { productId: 1, tenantId: 2, tool: 't', dryRun: false, confirm: true });
    expect('confirm' in noConfirm.payloads[0].payload).toBe(false);
    expect(confirm.payloads[0].payload.confirm).toBe(true);

    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m: any) => { lines.push(String(m)); });
    printReport('x.md', { status: 'NEEDS_CONFIRMATION', errors: [], completeness: [], notes: [], changes: [],
      counts: { rp: { created: 0, updated: 0, unchanged: 1, failed: 0, removed: 1 } },
      impacts: [{ nodeType: 'RP', nodeId: 4, kind: 'TASK', refId: 1450, name: '实现', status: 'in_progress' }] });
    spy.mockRestore();
    expect(lines.join('\n')).toContain('任务 #1450');
  });
});

describe('parseDocVersion', () => {
  it('takes the highest version in the history table regardless of row order', () => {
    expect(parseDocVersion('| 1.0.5 | 2026-10-03 | x |\n| 1.0.4 | 2026-10-01 | y |\n| 1.0.10 | 2026-10-04 | z |')).toBe('1.0.10');
    expect(parseDocVersion('no table')).toBeUndefined();
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

  it('requires --product and --tenant unless --parse-only', () => {
    expect(() => execSync(`npm run cli -- prd import-structure --prd-dir ${fixtureDir()}`, { stdio: 'pipe' })).toThrow();
  });
});
