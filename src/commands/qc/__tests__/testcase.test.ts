/**
 * Tests for `good7ob qc testcase` (g7b #1035).
 */

import { describe, expect, it } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectFeatureFiles, MAX_FILES_PER_REQUEST, parseStep, planBatches } from '../testcaseFiles';

describe('parseStep', () => {
  it('splits action and expected on the first "::"', () => {
    expect(parseStep(' 打开登录页 :: 显示表单 ')).toEqual({ action: '打开登录页', expected: '显示表单' });
    expect(parseStep('调用 a::b 接口::返回 200')).toEqual({ action: '调用 a', expected: 'b 接口::返回 200' });
    expect(parseStep('只有操作')).toEqual({ action: '只有操作', expected: '' });
  });
});

describe('collectFeatureFiles + planBatches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-tc-'));
  const write = (rel: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), 'Feature: x');
  };
  write('e2e/features/login.feature');
  write('e2e/features/auth/reset.feature');
  write('e2e/features/notes.md');
  write('node_modules/pkg/ignored.feature');
  write('top.feature');

  it('finds .feature files recursively, skipping node_modules and other files', () => {
    const files = collectFeatureFiles([root]).map((f) => path.relative(root, f));
    expect(files).toEqual(['e2e/features/auth/reset.feature', 'e2e/features/login.feature', 'top.feature']);
  });

  it('groups by directory relative to root so script paths match the repo', () => {
    const batches = planBatches(collectFeatureFiles([root]), root);
    expect(batches.map((b) => [b.basePath, b.files.map((f) => path.basename(f))])).toEqual([
      ['e2e/features/auth/', ['reset.feature']],
      ['e2e/features/', ['login.feature']],
      ['', ['top.feature']],
    ]);
  });

  it('uses one explicit prefix when --base-path is given, and splits large batches', () => {
    const many = Array.from({ length: MAX_FILES_PER_REQUEST + 1 }, (_, i) => path.join(root, `f${i}.feature`));
    const batches = planBatches(many, root, 'specs');
    expect(batches.map((b) => [b.basePath, b.files.length])).toEqual([['specs/', 50], ['specs/', 1]]);
  });

  it('rejects files outside root', () => {
    expect(() => planBatches([path.join(os.tmpdir(), 'elsewhere.feature')], root)).toThrow('--root');
  });
});

describe('qc testcase CLI', () => {
  const CLI = 'npm run cli --';

  it('registers the subcommands under qc testcase and the tc alias', () => {
    const help = execSync(`${CLI} qc tc --help`).toString();
    ['list', 'get', 'create', 'import', 'coverage', 'suites'].forEach((cmd) => expect(help).toContain(cmd));
  });

  it('import --dry-run prints script paths without calling the API', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-tc-dry-'));
    fs.mkdirSync(path.join(root, 'features'));
    fs.writeFileSync(path.join(root, 'features', 'a.feature'), 'Feature: a');
    const out = execSync(`${CLI} qc testcase import ${root}/features --product-id 1 --root ${root} --dry-run`).toString();
    expect(out).toContain('features/a.feature');
    expect(out).toContain('--dry-run');
  });
});
