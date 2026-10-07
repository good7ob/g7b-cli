import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDevInfoCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const dev = (args: string[], response = ok(null)) => runCli(registerDevInfoCommands, ['dev-info', ...args], response);

const DB_ITEM = {
  id: 5, ownerType: 'PROJECT', ownerId: 9, type: 'DATABASE', env: 'TEST', name: 'main-db', securityLevel: 'L2',
  fields: { host: 'db.local', port: '5432' },
  secrets: { password: { kind: 'VALUE', masked: '******' }, connectionString: { kind: 'REF', ref: 'vault://db/main' } },
  expired: false, canEdit: true, canReveal: true,
};
const EFFECTIVE = {
  ownerType: 'TASK', ownerId: 7,
  entries: [
    { item: DB_ITEM, sourceLayer: 'PROJECT', sourceOwnerId: 9, sourceOwnerName: 'shop', readOnly: true, overridesUpper: true, overrides: [] },
  ],
  apps: [{ id: 3, name: 'api', repoUrl: 'git@x:a/b.git', defaultBranch: 'main', deployTarget: 'ecs' }],
};

afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await dev(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain('参数错误');
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('dev-info get', () => {
  it('reads the layered summary of a task with filters, masked output, never calling reveal', async () => {
    const r = await dev(['get', '--task', '7', '--type', 'database', '--env', 'test'], ok(EFFECTIVE));
    expect(r.http.get).toHaveBeenCalledWith('/dev-info/task/7/effective', { params: { type: 'DATABASE', env: 'TEST' } });
    expect(r.http.post).not.toHaveBeenCalled();
    expect(r.stdout).toContain('host=db.local');
    expect(r.stdout).toContain('password=******');
    expect(r.stdout).toContain('connectionString=→ vault://db/main');
    expect(r.stdout).toContain('PROJECT shop');
    expect(r.stdout).toContain('覆盖上层');
    expect(r.stdout).toContain('git@x:a/b.git');
  });

  it.each([['--project', 'project'], ['--product', 'product'], ['--org', 'org']])('%s targets /dev-info/%s/<id>/effective', async (flag, seg) => {
    const r = await dev(['get', flag, '11', '--include-expired'], ok(EFFECTIVE));
    expect(r.http.get).toHaveBeenCalledWith(`/dev-info/${seg}/11/effective`, { params: { includeExpired: true } });
  });

  it('prints the raw summary with --json', async () => {
    const r = await dev(['get', '--task', '7', '--json'], ok(EFFECTIVE));
    expect(JSON.parse(r.stdout).entries[0].item.id).toBe(5);
  });

  it('says so when nothing is visible', async () => {
    const r = await dev(['get', '--task', '7'], ok({ ownerType: 'TASK', ownerId: 7, entries: [], apps: [] }));
    expect(r.stdout).toContain('没有可见的条目');
  });

  it('needs exactly one object', async () => {
    await expectRejected(['get'], '必须且只能指定');
    await expectRejected(['get', '--task', '1', '--project', '2'], '必须且只能指定');
    await expectRejected(['get', '--task', 'abc'], '--task');
  });

  it('rejects an unknown type before any request', async () => {
    await expectRejected(['get', '--task', '7', '--type', 'bogus'], '--type');
  });

  it('maps 2000 to a readable message and exits 1', async () => {
    const r = await dev(['get', '--task', '7'], bizError(2000, '无权'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('访问许可');
  });
});

describe('dev-info get --reveal', () => {
  it('calls reveal only when asked, linking the task, and prints just the value', async () => {
    const r = await dev(['get', '--task', '7', '--item', '5', '--reveal', 'password'],
      ok({ field: 'password', kind: 'VALUE', value: 's3cret', autoHideSeconds: 30 }));
    expect(r.http.post).toHaveBeenCalledWith('/dev-info/items/5/reveal', { field: 'password', taskId: 7 });
    expect(r.http.get).not.toHaveBeenCalled();
    expect(r.stdout.trim()).toBe('s3cret');
  });

  it('does not send a taskId when the object is not a task', async () => {
    const r = await dev(['get', '--project', '9', '--item', '5', '--reveal', 'password'],
      ok({ field: 'password', kind: 'VALUE', value: 'x', autoHideSeconds: 30 }));
    expect(r.http.post).toHaveBeenCalledWith('/dev-info/items/5/reveal', { field: 'password' });
  });

  it('requires --item together with --reveal', async () => {
    await expectRejected(['get', '--task', '7', '--reveal', 'password'], '--item');
    await expectRejected(['get', '--task', '7', '--item', '5'], '--reveal');
  });

  it('reports a refused reveal as an error without a value', async () => {
    const r = await dev(['get', '--task', '7', '--item', '5', '--reveal', 'password'], bizError(2000, '无权查看该条目的敏感值'));
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe('');
  });
});

describe('dev-info list / create / update / delete', () => {
  it('lists own entries masked', async () => {
    const r = await dev(['list', '--project', '9'], ok([DB_ITEM]));
    expect(r.http.get).toHaveBeenCalledWith('/dev-info/project/9/items', { params: undefined });
    expect(r.stdout).toContain('main-db');
    expect(r.stdout).toContain('password=******');
  });

  it('creates with fields and the three secret forms; the secret never appears in output', async () => {
    process.env.G7B_TEST_PW = 'from-env';
    const r = await dev(['create', '--project', '9', '--type', 'database', '--env', 'test', '--name', 'main-db',
      '--field', 'host=db.local', '--field', 'port=5432', '--secret', 'password=pw=1', '--secret-ref', 'connectionString=vault://x',
      '--secret-env', 'token=G7B_TEST_PW', '--expires', '2027-01-31'], ok(DB_ITEM));
    delete process.env.G7B_TEST_PW;
    expect(r.http.post).toHaveBeenCalledWith('/dev-info/project/9/items', {
      type: 'DATABASE', env: 'TEST', name: 'main-db', fields: { host: 'db.local', port: '5432' },
      secrets: { password: { value: 'pw=1' }, connectionString: { ref: 'vault://x' }, token: { value: 'from-env' } },
      expiresAt: '2027-01-31',
    });
    expect(r.stdout).toContain('已创建条目 #5');
    expect(r.stdout).not.toContain('pw=1');
    expect(r.stdout).not.toContain('from-env');
  });

  it('create validates before calling', async () => {
    await expectRejected(['create', '--project', '9', '--name', 'x'], '--type');
    await expectRejected(['create', '--project', '9', '--type', 'database'], '--type');
    await expectRejected(['create', '--project', '9', '--type', 'database', '--name', 'n', '--field', 'novalue'], 'key=value');
    await expectRejected(['create', '--project', '9', '--type', 'database', '--name', 'n', '--secret-env', 'p=G7B_NOT_SET_XYZ'], 'G7B_NOT_SET_XYZ');
    await expectRejected(['create', '--project', '9', '--type', 'database', '--name', 'n', '--expires', '2027-02-30'], '--expires');
    await expectRejected(['create', '--project', '9', '--type', 'database', '--name', 'n', '--level', 'L9'], '--level');
  });

  it('updates only what is given, and can clear the expiry', async () => {
    const r = await dev(['update', '5', '--description', 'new', '--clear-expires'], ok(DB_ITEM));
    expect(r.http.put).toHaveBeenCalledWith('/dev-info/items/5', { description: 'new', clearExpiresAt: true });
    await expectRejected(['update', '5', '--expires', '2027-01-01', '--clear-expires'], '不能同时使用');
  });

  it('deletes by id', async () => {
    const r = await dev(['delete', '5']);
    expect(r.http.delete).toHaveBeenCalledWith('/dev-info/items/5', undefined);
    expect(r.stdout).toContain('条目 #5 已删除');
    await expectRejected(['delete', '0'], 'id');
  });
});

describe('dev-info set-security', () => {
  it('sends level, reason and L4 nominees', async () => {
    const r = await dev(['set-security', '5', '--level', 'l4', '--l4-grantee', 'user:12', '--l4-grantee', 'AI_EMPLOYEE:3'], ok({ ...DB_ITEM, securityLevel: 'L4' }));
    expect(r.http.put).toHaveBeenCalledWith('/dev-info/items/5/security', {
      securityLevel: 'L4', l4Grantees: [{ type: 'USER', id: 12 }, { type: 'AI_EMPLOYEE', id: 3 }],
    });
    expect(r.stdout).toContain('L4');
  });

  it('lowering with a reason; empty L4 list; bad grantee rejected', async () => {
    const r = await dev(['set-security', '5', '--level', 'L2', '--reason', 'public test data', '--clear-l4-grantees'], ok(DB_ITEM));
    expect(r.http.put).toHaveBeenCalledWith('/dev-info/items/5/security', { securityLevel: 'L2', reason: 'public test data', l4Grantees: [] });
    await expectRejected(['set-security', '5', '--level', 'L4', '--l4-grantee', 'bot:1'], '--l4-grantee');
    await expectRejected(['set-security', '5', '--level', 'L4', '--l4-grantee', 'USER:1', '--clear-l4-grantees'], '不能同时使用');
  });
});

describe('dev-info clearance', () => {
  const CLEARANCE = { id: 8, granteeType: 'AI_EMPLOYEE', granteeId: 3, granteeName: 'Bot', level: 'L2', scopeType: 'PROJECT', scopeId: 9, createdAt: '2026-10-07T10:00:00' };

  it('lists with an optional grantee filter', async () => {
    const r = await dev(['clearance', 'list', '--org', '2', '--grantee', 'ai_employee:3'], ok([CLEARANCE]));
    expect(r.http.get).toHaveBeenCalledWith('/dev-info/clearances', { params: { orgId: 2, granteeType: 'AI_EMPLOYEE', granteeId: 3 } });
    expect(r.stdout).toMatch(/8\s+AI_EMPLOYEE:3\s+Bot\s+L2\s+PROJECT#9/);
  });

  it('grants with a scope', async () => {
    const r = await dev(['clearance', 'grant', '--org', '2', '--grantee', 'USER:12', '--level', 'l3', '--scope', 'project', '--scope-id', '9'], ok(CLEARANCE));
    expect(r.http.post).toHaveBeenCalledWith('/dev-info/clearances', {
      orgId: 2, grantee: { type: 'USER', id: 12 }, level: 'L3', scopeType: 'PROJECT', scopeId: 9,
    });
  });

  it('org scope needs no scope id; L4 is not a clearance; other scopes need an id', async () => {
    const r = await dev(['clearance', 'grant', '--org', '2', '--grantee', 'USER:12', '--level', 'L1', '--scope', 'ORG'], ok(CLEARANCE));
    expect(r.http.post).toHaveBeenCalledWith('/dev-info/clearances', { orgId: 2, grantee: { type: 'USER', id: 12 }, level: 'L1', scopeType: 'ORG' });
    await expectRejected(['clearance', 'grant', '--org', '2', '--grantee', 'USER:12', '--level', 'L4', '--scope', 'ORG'], '--level');
    await expectRejected(['clearance', 'grant', '--org', '2', '--grantee', 'USER:12', '--level', 'L2', '--scope', 'PRODUCT'], '--scope-id');
  });

  it('revokes', async () => {
    const r = await dev(['clearance', 'revoke', '8']);
    expect(r.http.delete).toHaveBeenCalledWith('/dev-info/clearances/8', undefined);
    expect(r.stdout).toContain('许可 #8 已收回');
  });
});
