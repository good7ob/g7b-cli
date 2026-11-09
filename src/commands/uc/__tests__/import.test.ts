import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Envelope, Responder, bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { registerUcCommands } from '../index';

const FILE = `@startuml t
title 用例图 · 登录（prd-0001 FP-1~2）
actor "用户\\n(说明)" as U
actor "管理员" as M
rectangle "认证" {
  usecase "登录" as A
  usecase "校验口令" as B
  usecase "审计" as C
  usecase "孤立节点" as D
}
U --> A
M --> A
U --> C
A ..> B : <<include>>
U --> B
M --> B
A ..> C : <<extend>>
@enduml
`;

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-import-'));
  file = path.join(dir, 'a.puml');
  fs.writeFileSync(file, FILE);
});
const savedEnv = { ...process.env };
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); process.env = { ...savedEnv }; vi.restoreAllMocks(); });

interface Stub {
  actors?: Array<{ id: number; name: string; enabled?: boolean }>;
  existing?: Array<{ id: number; code: string; actorName: string; goal: string }>;
  /** what the list answers from its second call on (a use case the first listing did not show) */
  existingLater?: Array<{ id: number; code: string; actorName: string; goal: string }>;
  /** per POST /products/7/use-cases call, in order; default: ok with a fresh id */
  creates?: Array<(n: number) => Envelope>;
  relation?: (url: string) => Envelope;
  failReads?: boolean;
}
function stub(s: Stub = {}): Responder {
  let created = 0;
  let nextActor = 100;
  let lists = 0;
  return (method, url) => {
    const m = method.toUpperCase();
    if (m === 'GET' && s.failReads) return bizError(2000, '无权');
    if (m === 'GET' && url === '/products/7/use-case-actors') return ok(s.actors ?? []);
    if (m === 'GET' && url === '/products/7/use-cases') return ok({ records: (lists++ > 0 && s.existingLater) || s.existing || [], pages: 1 });
    if (m === 'POST' && url === '/products/7/use-case-actors') return ok({ id: nextActor++ });
    if (m === 'POST' && url === '/products/7/use-cases') { const i = created++; return s.creates?.[i] ? s.creates[i](i) : ok({ id: 1000 + i, code: `UC-${i + 1}` }); }
    if (m === 'POST' && /\/relations$/.test(url)) return s.relation ? s.relation(url) : ok({});
    return ok(null);
  };
}
const imp = (args: string[], r: Responder = stub()) => runCli(registerUcCommands, ['uc', 'import', ...args], r);
const COMMON = ['--product', '7', '--priority', 'p1', '--channels', 'web,app'];
const writes = (r: Awaited<ReturnType<typeof imp>>) => [...r.http.post.mock.calls, ...r.http.put.mock.calls, ...r.http.delete.mock.calls];

describe('rp-ucase-0088 required parameters', () => {
  it('refuses a missing --priority or --channels before reading anything or calling the API', async () => {
    for (const [args, missing] of [[['--channels', 'web'], '--priority'], [['--priority', 'P1'], '--channels'], [[], '--priority、--channels']] as const) {
      const r = await imp([file, '--product', '7', ...args]);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain('参数错误');
      expect(r.stderr).toContain(`缺少 ${missing}`);
      expect(noHttpCalls(r)).toBe(true);
    }
  });

  it('rejects bad values and a missing product, and passes --submodule through to the body', async () => {
    for (const bad of [['--priority', 'P9', '--channels', 'web'], ['--priority', 'P1', '--channels', 'fax'], ['--priority', 'P1', '--channels', 'web', '--submodule', 'x']]) {
      const r = await imp([file, '--product', '7', ...bad]);
      expect(r.exitCode).toBe(1);
      expect(noHttpCalls(r)).toBe(true);
    }
    delete process.env.GOOD7OB_PRODUCT_ID;
    const noProduct = await imp([file, '--priority', 'P1', '--channels', 'web']);
    expect(noProduct.stderr).toContain('缺少产品 ID');
    const r = await imp([file, ...COMMON, '--submodule', '4', '--apply']);
    expect(r.http.post).toHaveBeenCalledWith('/products/7/use-cases', expect.objectContaining({ subModuleId: 4, priority: 'P1', channels: ['WEB', 'APP'] }));
  });
});

describe('rp-ucase-0085 / 0087 / 0089 preview', () => {
  it('lists what would be created and sends no write request', async () => {
    const r = await imp([file, ...COMMON], stub({ actors: [{ id: 1, name: '用户' }] }));
    expect(r.exitCode).toBeUndefined();
    expect(writes(r)).toEqual([]);
    expect(r.stdout).toContain('导入预览（未写入任何数据');
    expect(r.stdout).toContain('将创建 5，将跳过 0'); // 用户:登录 管理员:登录 用户:审计 用户:校验口令 管理员:校验口令
    expect(r.stdout).toContain('将新建角色 1 个: 管理员');
    expect(r.stdout).toContain('没有连任何角色的节点（不导入）（1）');
    expect(r.stdout).toMatch(/a\.puml:9\s+孤立节点/);
    expect(r.stdout).toContain('extend 缺少触发条件');
  });

  it('pre-judges duplicates from the product list (role without case / spaces, goal trimmed and case-folded)', async () => {
    const r = await imp([file, ...COMMON, '--verbose'], stub({
      actors: [{ id: 1, name: '用户' }, { id: 2, name: '管理员' }],
      existing: [{ id: 50, code: 'UC-9', actorName: '用 户', goal: ' 登录 ' }],
    }));
    expect(r.stdout).toContain('将创建 4，将跳过 1');
    expect(r.stdout).toMatch(/\[跳过\].*用户 \/ 登录\s+— 已有 UC-9/);
    expect(writes(r)).toEqual([]);
  });

  it('works without a backend: says the duplicate check was not made, still exits 0 and writes nothing', async () => {
    const r = await imp([file, ...COMMON], stub({ failReads: true }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('没有连上后端，未做重复预判与角色核对');
    expect(r.stdout).toContain('将创建 5');
    expect(writes(r)).toEqual([]);
  });

  it('--json is machine readable and carries the same facts', async () => {
    const r = await imp([file, ...COMMON, '--json'], stub());
    const j = JSON.parse(r.stdout);
    expect(j).toMatchObject({ mode: 'preview', productId: 7, priority: 'P1', channels: ['WEB', 'APP'], prejudged: true, failed: false });
    expect(j.cases).toHaveLength(5);
    expect(j.noRole).toHaveLength(1);
    expect(j.skippedDeps[0].kind).toBe('extend');
    expect(j.includes).toHaveLength(2);
  });

  it('unparsable lines are listed with file and line and are not fatal', async () => {
    fs.writeFileSync(file, FILE.replace('U --> A\n', 'U --> Q\n'));
    const r = await imp([file, ...COMMON]);
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toMatch(/无法解析的行.*\n\s+.*a\.puml:11\s+U --> Q\s+— 别名 Q 没有定义/);
  });
});

describe('--apply (rp-ucase-0087, 0089, 0090, 0091)', () => {
  it('creates missing roles once, then each use case with the note, then the include relations', async () => {
    const r = await imp([file, ...COMMON, '--apply'], stub({ actors: [{ id: 1, name: '用户' }] }));
    expect(r.exitCode).toBeUndefined();
    const posts = r.http.post.mock.calls;
    expect(posts.filter(([u]) => u === '/products/7/use-case-actors')).toEqual([['/products/7/use-case-actors', { name: '管理员' }]]);
    const bodies = posts.filter(([u]) => u === '/products/7/use-cases').map(([, b]) => b as Record<string, any>);
    expect(bodies).toHaveLength(5);
    expect(bodies[0]).toMatchObject({ actorId: 1, goal: '登录', priority: 'P1', channels: ['WEB', 'APP'] });
    expect(bodies[0].subModuleId).toBeUndefined();
    expect(bodies[0].note).toBe('导入自 a.puml\n图标题：用例图 · 登录（prd-0001 FP-1~2）\n分组：认证\n未转换的依赖：本用例 <<extend>> 审计');
    expect(bodies[1].actorId).toBe(100);
    expect(bodies.every((b) => b.targetReleaseId === undefined && b.functionPointIds === undefined)).toBe(true); // no FP link
    const rel = posts.filter(([u]) => /relations$/.test(u as string));
    expect(rel.map(([u, b]) => [u, b])).toEqual([
      ['/use-cases/1000/relations', { type: 'INCLUDE', targetUseCaseId: 1002 }],
      ['/use-cases/1001/relations', { type: 'INCLUDE', targetUseCaseId: 1003 }],
    ]);
    expect(r.http.put).not.toHaveBeenCalled();
    expect(r.http.delete).not.toHaveBeenCalled();
    expect(r.stdout).toContain('汇总: 创建 5，跳过 0，失败 0');
  });

  it('re-running: the server’s 15001 is a skip, not a failure; nothing is updated; relations still resolve ids from the list', async () => {
    const dup = () => bizError(15001, '同一产品内已有相同角色和目标的用例 UC-7');
    const r = await imp([file, ...COMMON, '--apply'], stub({
      actors: [{ id: 1, name: '用户' }, { id: 2, name: '管理员' }],
      existing: [],
      existingLater: [
        { id: 7, code: 'UC-7', actorName: '用户', goal: '登录' }, { id: 8, code: 'UC-8', actorName: '管理员', goal: '登录' }, { id: 9, code: 'UC-9', actorName: '用户', goal: '审计' },
        { id: 10, code: 'UC-10', actorName: '用户', goal: '校验口令' }, { id: 11, code: 'UC-11', actorName: '管理员', goal: '校验口令' },
      ],
      creates: [dup, dup, dup, dup, dup],
      relation: () => bizError(15009, '已有关系'),
    }));
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('汇总: 创建 0，跳过 5，失败 0');
    expect(r.http.post.mock.calls.filter(([u]) => /relations$/.test(u as string)).map(([u]) => u)).toEqual(['/use-cases/7/relations', '/use-cases/8/relations']);
    expect(r.http.put).not.toHaveBeenCalled();
  });

  it('a local pre-judged duplicate sends no create request at all', async () => {
    const r = await imp([file, ...COMMON, '--apply'], stub({
      actors: [{ id: 1, name: '用户' }, { id: 2, name: '管理员' }],
      existing: [{ id: 7, code: 'UC-7', actorName: '用户', goal: '登录' }, { id: 8, code: 'UC-8', actorName: '管理员', goal: '登录' }],
    }));
    expect(r.http.post.mock.calls.filter(([u]) => u === '/products/7/use-cases')).toHaveLength(3);
  });

  it('server and local disagree: the server wins and the report says so', async () => {
    const r = await imp([file, ...COMMON, '--apply', '--verbose'], stub({ actors: [{ id: 1, name: '用户' }, { id: 2, name: '管理员' }], creates: [() => bizError(15001, '重复 UC-3')], existingLater: [{ id: 3, code: 'UC-3', actorName: '用户', goal: '登录' }] }));
    expect(r.stdout).toMatch(/\[跳过\].*用户 \/ 登录\s+— 服务端判定重复: 重复 UC-3/);
    expect(r.exitCode).toBeUndefined();
  });

  it('a non-duplicate failure is listed, the others are kept, and the exit code is 1', async () => {
    const r = await imp([file, ...COMMON, '--apply'], stub({ actors: [{ id: 1, name: '用户' }, { id: 2, name: '管理员' }], creates: [() => ok({ id: 1, code: 'UC-1' }), () => bizError(15003, '角色已停用')] }));
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('用例创建失败（1）');
    expect(r.stdout).toContain('角色已停用');
    expect(r.stdout).toContain('创建 4，跳过 0，失败 1');
    expect(r.http.post.mock.calls.filter(([u]) => u === '/products/7/use-cases')).toHaveLength(5);
  });

  it('a failed relation (e.g. a cycle) fails the run; a relation whose end failed is reported, not sent', async () => {
    const cyc = await imp([file, ...COMMON, '--apply'], stub({ actors: [{ id: 1, name: '用户' }, { id: 2, name: '管理员' }], relation: () => bizError(15008, '成环') }));
    expect(cyc.exitCode).toBe(1);
    expect(cyc.stdout).toContain('include 关系失败（2）');
    const blocked = await imp([file, ...COMMON, '--apply'], stub({ actors: [{ id: 1, name: '用户' }, { id: 2, name: '管理员' }], creates: [() => bizError(1001, '坏')] }));
    expect(blocked.exitCode).toBe(1);
    expect(blocked.http.post.mock.calls.filter(([u]) => /relations$/.test(u as string))).toHaveLength(1);
  });

  it('refuses to write when the product’s roles / use cases cannot be read', async () => {
    const r = await imp([file, ...COMMON, '--apply'], stub({ failReads: true }));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('导入用例失败');
    expect(writes(r)).toEqual([]);
  });

  it('a goal over 200 characters is reported and never sent, cut or not', async () => {
    fs.writeFileSync(file, `actor "用户" as U\nusecase "${'长'.repeat(201)}" as A\nusecase "短" as B\nU --> A\nU --> B\n`);
    const r = await imp([file, ...COMMON, '--apply'], stub({ actors: [{ id: 1, name: '用户' }] }));
    expect(r.stdout).toContain('无法导入的用例（1）');
    expect(r.stdout).toContain('超过 200 字');
    const bodies = r.http.post.mock.calls.filter(([u]) => u === '/products/7/use-cases').map(([, b]) => (b as { goal: string }).goal);
    expect(bodies).toEqual(['短']);
  });
});

describe('files and directories (rp-ucase-0085, 0092)', () => {
  it('a directory is searched recursively for .puml only; .png and other files are never read or imported', async () => {
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'b.puml'), 'actor "用户" as U\nusecase "另一个" as X\nU --> X\n');
    fs.writeFileSync(path.join(dir, 'a.png'), 'not a puml');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'actor "x" as Y');
    const r = await imp([dir, ...COMMON, '--json']);
    const j = JSON.parse(r.stdout);
    expect(j.files.map((f: { file: string }) => path.basename(f.file))).toEqual(['a.puml', 'b.puml']);
    expect(j.cases).toHaveLength(6);
  });

  it('a missing path, or a .png given explicitly, is a read failure: the rest is still reported, exit code 1', async () => {
    fs.writeFileSync(path.join(dir, 'x.png'), 'png');
    const r = await imp([file, path.join(dir, 'missing.puml'), path.join(dir, 'x.png'), ...COMMON]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toContain('读取失败（2）');
    expect(r.stdout).toContain('将创建 5');
    expect(r.stdout).toContain('不是 .puml 文件');
    expect(writes(r)).toEqual([]);
  });

  it('the same file given twice is read once; an empty directory is an input error', async () => {
    const r = await imp([file, file, dir, ...COMMON, '--json']);
    expect(JSON.parse(r.stdout).files).toHaveLength(1);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-empty-'));
    const e = await imp([empty, ...COMMON]);
    fs.rmSync(empty, { recursive: true });
    expect(e.exitCode).toBe(1);
    expect(e.stderr).toContain('没有找到 .puml 文件');
  });
});
