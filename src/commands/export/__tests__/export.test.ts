import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { registerExportCommands, waitSettings } from '../index';

vi.mock('../../file/download', () => ({ saveUrlTo: vi.fn(async () => 4096) }));
import { saveUrlTo } from '../../file/download';

const exp = (args: string[], response = ok(null)) => runCli(registerExportCommands, ['export', ...args], response);

const job = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 8, objectType: 'PRD_DOCUMENT', objectId: 9, objectTitle: '对象文件', format: 'pdf', status,
  resultFileId: null, errorMessage: null, ...extra,
});
const FILE = { fileId: 501, versionNo: 1, fileName: 'PRD-0132-对象文件-20261026.pdf' };

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-export-'));
  vi.mocked(saveUrlTo).mockClear();
});
afterEach(() => {
  waitSettings.pollMs = 2000;
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('export prd', () => {
  it('starts a job with the chosen options and prints it without waiting', async () => {
    const r = await exp(['prd', '9', '--format', 'PDF', '--toc', '--cover'], ok(job('queued')));
    expect(r.http.post).toHaveBeenCalledWith('/export/jobs', { objectType: 'PRD_DOCUMENT', objectId: 9, format: 'pdf', toc: true, cover: true });
    expect(r.stdout).toContain('#8');
    expect(r.stdout).toContain('queued');
  });

  it('refuses png / svg and bad slide levels before any request', async () => {
    for (const args of [['prd', '9', '--format', 'png'], ['prd', '9', '--format', 'pptx', '--slide-level', '3'], ['prd', 'x', '--format', 'md']]) {
      const r = await exp(args);
      expect(r.exitCode).toBe(1);
      expect(noHttpCalls(r)).toBe(true);
    }
  });

  it('turns the server refusals into readable messages', async () => {
    const r = await exp(['prd', '9', '--format', 'pdf'], bizError(1007, '正在导出的任务已有 3 个'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('3 个');
  });

  it('polls until done, then downloads the result by name and never prints the address', async () => {
    waitSettings.pollMs = 1;
    let polls = 0;
    const run = exp(['prd', '9', '--format', 'pdf', '--out', path.join(dir, 'x') + path.sep], (m: string, url: string) => {
      if (m === 'post') return ok(job('queued'));
      if (url === '/export/jobs/8') return ok(++polls < 2 ? job('running') : job('done', { resultFileId: 501 }));
      if (url.endsWith('/versions')) return ok([FILE]);
      return ok({ url: 'https://signed.example/z?sig=secret' });
    });
    const r = await run;
    expect(saveUrlTo).toHaveBeenCalledWith('https://signed.example/z?sig=secret', path.join(dir, 'x', FILE.fileName));
    expect(r.stdout).toContain('结果文件 #501');
    expect(r.stdout).toContain('已保存');
    expect(r.stdout).not.toContain('signed.example');
  });

  it('shows the failure reason and exits non-zero when the job fails', async () => {
    const r = await exp(['prd', '9', '--format', 'md', '--wait'], ok(job('failed', { errorMessage: '空间不足' })));
    expect(r.stdout).toContain('失败：空间不足');
    expect(process.exitCode).toBe(1);
  });
});

describe('export deliverables / job / cancel', () => {
  it('sends the product and a validated period', async () => {
    const r = await exp(['deliverables', '42', '--format', 'docx', '--from', '2026-10-01', '--to', '2026-10-26'], ok(job('queued', { objectType: 'DELIVERABLE_LIST' })));
    expect(r.http.post).toHaveBeenCalledWith('/export/jobs', {
      objectType: 'DELIVERABLE_LIST', productId: 42, from: '2026-10-01', to: '2026-10-26', format: 'docx',
    });
    const bad = await exp(['deliverables', '42', '--format', 'docx', '--from', '2026-13-01']);
    expect(bad.exitCode).toBe(1);
    expect(noHttpCalls(bad)).toBe(true);
  });

  it('reads and cancels a job', async () => {
    const r = await exp(['job', '8'], ok(job('running')));
    expect(r.stdout).toContain('running');
    const c = await exp(['cancel', '8']);
    expect(c.http.post).toHaveBeenCalledWith('/export/jobs/8/cancel', undefined);
    expect(c.stdout).toContain('已取消');
  });
});
