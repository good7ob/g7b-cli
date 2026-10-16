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
import { buildUpdateBody, validateUpdate } from '../testcaseUpdate';

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
    ['list', 'get', 'create', 'update', 'import', 'coverage', 'suites'].forEach((cmd) => expect(help).toContain(cmd));
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

describe('qc testcase update helpers', () => {
  const cur = {
    id: 7, caseNo: 'TC-7', productId: 10, suiteId: 3, subModuleId: null, title: 'T', precondition: 'P',
    steps: [{ action: 'a', expected: 'b' }], caseType: 'Functional', priority: 'P1', execMode: 'Manual',
    status: 'Draft', tags: ['x', 'y'], scriptPath: null, scriptScenario: null,
  };

  it('keeps every untouched field and only changes the requested one', () => {
    const b = buildUpdateBody(cur, { priority: 'P0' });
    expect(b).toMatchObject({ priority: 'P0', title: 'T', suiteId: 3, tags: ['x', 'y'], steps: cur.steps, productId: 10 });
  });

  it('adds, removes and de-duplicates tags; --tags replaces', () => {
    expect(buildUpdateBody(cur, { addTag: ['y,z', 'w'], removeTag: ['x'] }).tags).toEqual(['y', 'z', 'w']);
    expect(buildUpdateBody(cur, { tags: 'a, b' }).tags).toEqual(['a', 'b']);
  });

  it('Automated needs script path and scenario, either already stored or given', () => {
    expect(() => buildUpdateBody(cur, { mode: 'Automated' })).toThrow('脚本路径');
    const ok = buildUpdateBody(cur, { mode: 'Automated', scriptPath: 'e2e/a.feature', scriptScenario: 's' });
    expect(ok).toMatchObject({ execMode: 'Automated', scriptPath: 'e2e/a.feature', scriptScenario: 's' });
    expect(buildUpdateBody({ ...cur, scriptPath: 'p', scriptScenario: 's' }, { clearScript: true, mode: 'Manual' }))
      .toMatchObject({ scriptPath: null, scriptScenario: null, execMode: 'Manual' });
  });

  it('sets the automation assessment and keeps the stored one otherwise', () => {
    expect(buildUpdateBody(cur, { automation: 'READY' })).toMatchObject({ automationFeasibility: 'READY', automationNote: null });
    const assessed = { ...cur, automationFeasibility: 'MANUAL_ONLY', automationNote: '邮件验证码' };
    expect(buildUpdateBody(assessed, { priority: 'P0' })).toMatchObject({ automationFeasibility: 'MANUAL_ONLY', automationNote: '邮件验证码' });
    expect(buildUpdateBody(assessed, { automationNote: '短信' })).toMatchObject({ automationFeasibility: 'MANUAL_ONLY', automationNote: '短信' });
    expect(() => validateUpdate({ automation: 'MAYBE' }, 1)).toThrow('--automation');
    expect(() => validateUpdate({ automation: 'PARTIAL' }, 9)).not.toThrow();
  });

  it('replaces steps when --step is given', () => {
    expect(buildUpdateBody(cur, { step: ['go::ok'] }).steps).toEqual([{ action: 'go', expected: 'ok' }]);
  });

  it('validateUpdate rejects no-op, conflicting and multi-case single-only options', () => {
    expect(() => validateUpdate({}, 1)).toThrow('至少指定');
    expect(() => validateUpdate({ title: 'x' }, 2)).toThrow('--title');
    expect(() => validateUpdate({ scriptPath: 'p' }, 3)).toThrow('--script-path');
    expect(() => validateUpdate({ tags: 'a', addTag: ['b'] }, 1)).toThrow('不能与');
    expect(() => validateUpdate({ clearScript: true, scriptPath: 'p' }, 1)).toThrow('不能与');
    expect(() => validateUpdate({ addTag: ['a'] }, 5)).not.toThrow();
  });
});
