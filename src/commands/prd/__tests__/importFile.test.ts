import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { registerPrdCommands } from '../index';
import { ok, runCli } from '../../../utils/__tests__/cliHarness';

let tmpFile: string;

beforeEach(() => {
  tmpFile = path.join(os.tmpdir(), `import-file-test-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, '# 首页 PRD\n\n内容\n');
});

afterEach(() => {
  fs.rmSync(tmpFile, { force: true });
});

const importFile = (args: string[], response = ok({ sessionId: '1', documentId: 5, title: '首页 PRD', version: 'v1' })) =>
  runCli(registerPrdCommands, ['prd', 'import-file', tmpFile, ...args], response);

describe('good7ob prd import-file --product-id', () => {
  it('forwards --product-id as a numeric productId', async () => {
    const r = await importFile(['--product-id', '10']);

    expect(r.http.post).toHaveBeenCalledWith(
      '/forge/prd/import',
      expect.objectContaining({ title: '首页 PRD', productId: 10 })
    );
    expect(r.exitCode).toBeUndefined();
  });

  it('omits productId when --product-id is not given', async () => {
    const r = await importFile([]);

    expect(r.http.post).toHaveBeenCalledWith(
      '/forge/prd/import',
      expect.objectContaining({ productId: undefined })
    );
  });
});
