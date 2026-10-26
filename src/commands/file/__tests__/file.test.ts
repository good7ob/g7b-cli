import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../../services/ApiClient';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { registerFileCommands } from '../index';

vi.mock('../download', () => ({ saveUrlTo: vi.fn(async () => 2048) }));
import { saveUrlTo } from '../download';

const file = (args: string[], response = ok(null)) => runCli(registerFileCommands, ['file', ...args], response);

const ITEM = {
  fileId: 5, groupId: 5, fileName: 'spec.pdf', versionNo: 2, sizeBytes: 2048, source: 'upload', note: null,
  scanStatus: 'clean', confidential: false, inKnowledgeBase: true, referenced: false, ownerType: 'PRODUCT',
  ownerId: 42, retentionUntil: null, createdAt: '2026-10-26T10:00:00',
};
const PAGE = { items: [ITEM], total: 1, page: 1, size: 20 };

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-file-cmd-'));
  vi.mocked(saveUrlTo).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('file list', () => {
  it('lists an object’s files with filters and shows version, size, status and flags', async () => {
    const r = await file(['list', 'Product', '42', '--source', 'upload', '--keyword', 'spec', '--children'], ok(PAGE));
    expect(r.http.get).toHaveBeenCalledWith('/objects/product/42/files', {
      params: { source: 'upload', keyword: 'spec', includeChildren: true, page: 1, size: 20 },
    });
    expect(r.stdout).toContain('spec.pdf');
    expect(r.stdout).toContain('v2');
    expect(r.stdout).toContain('2.0 KB');
    expect(r.stdout).toContain('知识库');
  });

  it('rejects a bad object type or id before any request', async () => {
    const r = await file(['list', 'bug', '42']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
    const r2 = await file(['list', 'task', 'abc']);
    expect(r2.exitCode).toBe(1);
    expect(noHttpCalls(r2)).toBe(true);
  });

  it('turns a not-found into a readable message', async () => {
    const r = await file(['list', 'task', '9'], bizError(1002, '对象不存在'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('不存在');
  });
});

describe('file upload', () => {
  it('checks the local files first and uploads each one with the note and new-file flag', async () => {
    const a = path.join(dir, 'a.txt');
    fs.writeFileSync(a, 'hello');
    const spy = vi.spyOn(apiClient, 'uploadFiles').mockResolvedValue(ITEM);

    const r = await file(['upload', 'task', '7', a, '--note', 'weekly', '--new-file']);

    expect(spy).toHaveBeenCalledWith('/objects/task/7/files', [a], 'file', { note: 'weekly', asNewFile: 'true' });
    expect(r.stdout).toContain('已上传 #5');
    expect(r.exitCode).toBeUndefined();
  });

  it('refuses a missing file without calling the server', async () => {
    const spy = vi.spyOn(apiClient, 'uploadFiles').mockResolvedValue(ITEM);
    const r = await file(['upload', 'task', '7', path.join(dir, 'nope.txt')]);
    expect(r.exitCode).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('file download', () => {
  const versions = [{ ...ITEM, fileId: 6, versionNo: 3 }, ITEM];

  it('names the file from the server, signs the address, saves it and never prints the address', async () => {
    const out = path.join(dir, 'out') + path.sep;
    const r = await file(['download', '5', '--out', out], (m: string, url: string) =>
      url.endsWith('/versions') ? ok(versions) : ok({ url: 'https://signed.example/x?sig=secret' }));
    expect(saveUrlTo).toHaveBeenCalledWith('https://signed.example/x?sig=secret', path.join(dir, 'out', 'spec.pdf'), false);
    expect(r.stdout).toContain('已保存');
    expect(r.stdout).not.toContain('signed.example');
    expect(r.stderr).not.toContain('signed.example');
  });

  it('asks for a specific version and picks that version’s name', async () => {
    const r = await file(['download', '5', '--version', '3', '--out', path.join(dir, 'v3.pdf')], (m: string, url: string) =>
      url.endsWith('/versions') ? ok(versions) : ok({ url: 'https://signed.example/y' }));
    expect(r.http.get).toHaveBeenCalledWith('/files/5/download-url', { params: { version: 3 } });
    expect(saveUrlTo).toHaveBeenCalledWith('https://signed.example/y', path.join(dir, 'v3.pdf'), false);
  });

  it('keeps an existing file unless --force and asks for no address in that case', async () => {
    const target = path.join(dir, 'spec.pdf');
    fs.writeFileSync(target, 'old');
    const r = await file(['download', '5', '--out', target], ok(versions));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('未覆盖');
    expect(saveUrlTo).not.toHaveBeenCalled();
    expect(r.http.get).not.toHaveBeenCalledWith('/files/5/download-url', expect.anything());
  });

  it('reports a file that is still being scanned from the server’s refusal', async () => {
    const r = await file(['download', '5', '--out', path.join(dir, 'z.pdf')], (m: string, url: string) =>
      url.endsWith('/versions') ? ok(versions) : bizError(1007, '文件正在扫描，请稍后再试'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('状态');
    expect(saveUrlTo).not.toHaveBeenCalled();
  });
});

describe('file kb / delete / versions', () => {
  it('needs exactly one of --on and --off', async () => {
    expect((await file(['kb', '5'])).exitCode).toBe(1);
    const both = await file(['kb', '5', '--on', '--off']);
    expect(both.exitCode).toBe(1);
    expect(noHttpCalls(both)).toBe(true);
  });

  it('switches a file in and out', async () => {
    const on = await file(['kb', '5', '--on']);
    expect(on.http.put).toHaveBeenCalledWith('/files/5/kb', { enabled: true });
    const off = await file(['kb', '5', '--off']);
    expect(off.http.put).toHaveBeenCalledWith('/files/5/kb', { enabled: false });
  });

  it('deletes and lists versions', async () => {
    const del = await file(['delete', '5']);
    expect(del.http.delete).toHaveBeenCalledWith('/files/5', undefined);
    const ver = await file(['versions', '5'], ok([ITEM]));
    expect(ver.http.get).toHaveBeenCalledWith('/files/5/versions', { params: undefined });
    expect(ver.stdout).toContain('v2');
  });
});

describe('file confidential / history / channel', () => {
  it('needs exactly one of --on and --off, then sets the flag', async () => {
    const none = await file(['confidential', '5']);
    expect(none.exitCode).toBe(1);
    expect(noHttpCalls(none)).toBe(true);
    const on = await file(['confidential', '5', '--on']);
    expect(on.http.put).toHaveBeenCalledWith('/files/5/confidential', { value: true });
    expect(on.stdout).toContain('机密');
    const off = await file(['confidential', '5', '--off']);
    expect(off.http.put).toHaveBeenCalledWith('/files/5/confidential', { value: false });
  });

  it('shows the access history with actions, versions and channel; limit is checked', async () => {
    const entries = [
      { id: 2, fileId: 5, versionNo: 1, action: 'download', actorId: 9, channel: 'cli', createdAt: '2026-10-26T10:00:00' },
      { id: 1, fileId: 5, versionNo: null, action: 'scan_infected', actorId: null, channel: 'system', createdAt: '2026-10-26T09:00:00' },
    ];
    const r = await file(['history', '5', '--limit', '20'], ok(entries));
    expect(r.http.get).toHaveBeenCalledWith('/files/5/access', { params: { limit: 20 } });
    expect(r.stdout).toContain('下载');
    expect(r.stdout).toContain('v1');
    expect(r.stdout).toContain('#9');
    expect(r.stdout).toContain('系统');

    const bad = await file(['history', '5', '--limit', '500']);
    expect(bad.exitCode).toBe(1);
    expect(noHttpCalls(bad)).toBe(true);
  });

  it('marks every file command as coming from the CLI', async () => {
    await file(['versions', '5'], ok([]));
    expect(apiClient['instance'].defaults.headers.common['X-Client-Channel']).toBe('cli');
  });
});
