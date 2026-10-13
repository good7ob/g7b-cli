import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { registerPrdCommands } from '../index';
import { extractPrdNo } from '../importFile';
import { ok, runCli } from '../../../utils/__tests__/cliHarness';

afterEach(() => vi.restoreAllMocks());

const prd = (args: string[], response = ok(null)) => runCli(registerPrdCommands, ['prd', ...args], response);

describe('extractPrdNo', () => {
  it.each([
    ['| 文档编号 | PRD-good7ob-0004 |', 'prd-0004'],
    ['| **文档编号** | `PRD-good7ob-0123` |', 'prd-0123'],
    ['| 文档编号 | prd-12 |', 'prd-0012'],
  ])('%s -> %s', (line, expected) => expect(extractPrdNo(`# T\n\n${line}\n`)).toBe(expected));

  it('returns undefined without a 文档编号 row', () => {
    expect(extractPrdNo('# T\n\n见 PRD-good7ob-0004\n')).toBeUndefined();
  });
});

describe('prd import-file prdNo', () => {
  const write = (body: string) => {
    const f = path.join(os.tmpdir(), `lib-${Date.now()}-${Math.random()}.md`);
    fs.writeFileSync(f, body);
    return f;
  };
  const doc = '# 首页\n\n| 文档编号 | PRD-good7ob-0004 |\n';
  const resp = ok({ sessionId: '1', documentId: 5, prdId: '9', prdNo: 'prd-0004', unchanged: false, title: '首页' });

  it('sends auto-extracted prdNo with --product-id', async () => {
    const f = write(doc);
    const r = await prd(['import-file', f, '--product-id', '10'], resp);
    expect(r.http.post).toHaveBeenCalledWith('/forge/prd/import', expect.objectContaining({ productId: 10, prdNo: 'prd-0004' }));
    expect(r.stdout).toContain('prd-0004');
    fs.rmSync(f);
  });

  it('auto-extracted prdNo without --product-id: drops prdNo and warns', async () => {
    const f = write(doc);
    const r = await prd(['import-file', f], resp);
    const body = r.http.post.mock.calls[0][1];
    expect(body.prdNo).toBeUndefined();
    expect(r.stderr).toContain('⚠');
    expect(r.exitCode).toBeUndefined();
    fs.rmSync(f);
  });

  it('explicit --prd-no overrides extraction', async () => {
    const f = write(doc);
    const r = await prd(['import-file', f, '--product-id', '10', '--prd-no', 'prd-0099'], resp);
    expect(r.http.post.mock.calls[0][1].prdNo).toBe('prd-0099');
    fs.rmSync(f);
  });

  it('explicit --prd-no without --product-id errors before any HTTP call', async () => {
    const f = write(doc);
    const r = await prd(['import-file', f, '--prd-no', 'prd-0099'], resp);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--product-id');
    expect(r.http.post).not.toHaveBeenCalled();
    fs.rmSync(f);
  });

  it('prints unchanged hint', async () => {
    const f = write(doc);
    const r = await prd(['import-file', f, '--product-id', '10'], ok({ prdId: '9', prdNo: 'prd-0004', unchanged: true, sessionId: '1', documentId: 5 }));
    expect(r.stdout).toContain('内容未变，未新增版本');
    fs.rmSync(f);
  });
});

describe('prd list', () => {
  const page = ok({ list: [{ prdId: '9', prdNo: 'prd-0004', title: '首页', status: 'draft', productId: '10', productName: 'P', source: 'import', sessionCount: 2, updatedAt: '2026-10-08 10:00:00' }], total: 1, page: 1, pageSize: 20 });

  it('GETs /forge/prd/prds with filters', async () => {
    const r = await prd(['list', '--product-id', '10', '--source', 'import', '--status', 'draft', '--keyword', '首页', '--page', '2', '--limit', '5'], page);
    expect(r.http.get).toHaveBeenCalledWith('/forge/prd/prds', expect.objectContaining({
      params: { productId: 10, source: 'import', status: 'draft', keyword: '首页', page: 2, pageSize: 5 },
    }));
    expect(r.stdout).toContain('prd-0004');
  });

  it('--unassigned sends unassigned=true', async () => {
    const r = await prd(['list', '--unassigned'], page);
    expect(r.http.get.mock.calls[0][1].params.unassigned).toBe(true);
  });

  it('rejects --product-id with --unassigned', async () => {
    const r = await prd(['list', '--product-id', '1', '--unassigned'], page);
    expect(r.exitCode).toBe(1);
    expect(r.http.get).not.toHaveBeenCalled();
  });
});

describe('prd bind', () => {
  it('PUTs productId and subModuleId', async () => {
    const r = await prd(['bind', '9', '--product-id', '10', '--sub-module-id', '3']);
    expect(r.http.put).toHaveBeenCalledWith('/forge/prd/prds/9/product', { productId: 10, subModuleId: 3 });
  });

  it('none unbinds', async () => {
    const r = await prd(['bind', '9', '--product-id', 'none']);
    expect(r.http.put.mock.calls[0][0]).toBe('/forge/prd/prds/9/product');
    expect(r.http.put.mock.calls[0][1]).toEqual({ productId: null });
  });

  it('rejects a bad product id', async () => {
    const r = await prd(['bind', '9', '--product-id', 'abc']);
    expect(r.exitCode).toBe(1);
    expect(r.http.put).not.toHaveBeenCalled();
  });
});
