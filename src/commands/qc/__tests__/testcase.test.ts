/**
 * Tests for `good7ob qc testcase` (g7b #1035).
 */

import { describe, expect, it } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  collectFeatureFiles,
  ensureSuitePath,
  MAX_FILES_PER_REQUEST,
  parseStep,
  planBatches,
  readBatchFile,
  SuiteRef,
} from '../testcaseFiles';

describe('create-batch helpers', () => {
  it('ensureSuitePath creates missing levels once and reuses them', async () => {
    const suites: SuiteRef[] = [{ id: 1, parentId: null, name: '组织管理' }];
    let nextId = 10;
    const calls: string[] = [];
    const create = async (name: string, parentId: number | null) => {
      calls.push(`${parentId}/${name}`);
      return { id: nextId++, parentId, name };
    };

    expect(await ensureSuitePath('组织管理/成员管理', suites, create)).toBe(10);
    expect(await ensureSuitePath(' 组织管理 / 成员管理 ', suites, create)).toBe(10);
    expect(await ensureSuitePath('组织管理/邀请', suites, create)).toBe(11);
    expect(calls).toEqual(['1/成员管理', '1/邀请']);
    await expect(ensureSuitePath(' / ', suites, create)).rejects.toThrow('目录路径为空');
  });

  it('readBatchFile accepts an array or { cases } and rejects cases without title or steps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-tc-batch-'));
    const write = (name: string, body: unknown) => {
      fs.writeFileSync(path.join(dir, name), JSON.stringify(body));
      return path.join(dir, name);
    };
    const ok = { title: 't', steps: [{ action: 'a', expected: 'b' }] };

    expect(readBatchFile(write('a.json', [ok]))).toHaveLength(1);
    expect(readBatchFile(write('b.json', { cases: [ok, ok] }))).toHaveLength(2);
    expect(() => readBatchFile(write('c.json', []))).toThrow('非空');
    expect(() => readBatchFile(write('d.json', [ok, { title: 'x' }]))).toThrow('第 2 条缺少 steps');
  });
});

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
