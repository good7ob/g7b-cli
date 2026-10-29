import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../../services/ApiClient';
import { noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { registerQcCommands } from '../index';
import {
  buildImportMeta,
  collectScreenshots,
  registerTestRunCommands,
  validateUploadOptions,
  MAX_EVIDENCE_PER_CASE,
} from '../testRun';
import { detectFormat, parseJunit, parsePlaywright, parseReport, MAX_RESULTS } from '../testRunReport';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-test-run-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (rel: string, content: string | Buffer = 'x') => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
};
/** sparse file of the given size (no real disk use) */
const sparse = (rel: string, bytes: number) => {
  const p = write(rel, '');
  fs.truncateSync(p, bytes);
  return p;
};

/** Playwright JSON reporter shape: file suite → describe suite → specs → tests → results → attachments */
const playwrightReport = (shotDir: string) => ({
  config: {},
  suites: [
    {
      title: 'login.spec.ts',
      file: 'login.spec.ts',
      specs: [],
      suites: [
        {
          title: 'Login',
          file: 'login.spec.ts',
          specs: [
            {
              title: 'user can log in',
              file: 'login.spec.ts',
              tests: [{ projectName: 'chromium', status: 'expected', results: [{ status: 'passed', attachments: [] }] }],
            },
            {
              title: 'wrong password shows error',
              file: 'login.spec.ts',
              tests: [
                {
                  projectName: 'chromium',
                  status: 'unexpected',
                  results: [
                    {
                      status: 'failed',
                      attachments: [
                        { name: 'screenshot', contentType: 'image/png', path: path.join(shotDir, 'login-wrong-password-chromium', 'test-failed-1.png') },
                        { name: 'trace', contentType: 'application/zip', path: path.join(shotDir, 'login-wrong-password-chromium', 'trace.zip') },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              title: 'remember me',
              file: 'login.spec.ts',
              tests: [{ projectName: 'chromium', status: 'flaky', results: [{ status: 'failed' }, { status: 'passed' }] }],
            },
            {
              title: 'sso',
              file: 'login.spec.ts',
              tests: [{ projectName: 'chromium', status: 'skipped', results: [{ status: 'skipped' }] }],
            },
          ],
        },
      ],
    },
  ],
});

const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<!-- generated -->
<testsuites name="api" tests="4">
  <testsuite name="OrderApiTest" tests="4">
    <testcase classname="OrderApiTest" name="createOrder" time="0.1"/>
    <testcase classname="OrderApiTest" name="cancelOrder" time="0.2"><failure message="expected 200">stack</failure></testcase>
    <testcase classname="OrderApiTest" name="refund" time="0.2"><error type="NPE"/></testcase>
    <testcase classname='OrderApiTest' name='archive'><skipped/></testcase>
  </testsuite>
</testsuites>`;

describe('detectFormat', () => {
  it('honours --format and rejects an unknown one', () => {
    expect(detectFormat('r.json', '{}', 'junit')).toBe('junit');
    expect(detectFormat('r.json', '{}', 'Playwright')).toBe('playwright');
    expect(() => detectFormat('r.json', '{}', 'allure')).toThrow(/--format/);
  });

  it('recognises JUnit by extension or by an XML root, whatever the extension', () => {
    expect(detectFormat('results.xml', JUNIT)).toBe('junit');
    expect(detectFormat('results.txt', JUNIT)).toBe('junit');
    expect(detectFormat('single.xml', '<testsuite name="a"><testcase name="b"/></testsuite>')).toBe('junit');
    expect(() => detectFormat('pom.xml', '<project></project>')).toThrow(/testsuites/);
  });

  it('tells Playwright JSON from the g7b result array by content', () => {
    expect(detectFormat('report.json', JSON.stringify(playwrightReport('/x')))).toBe('playwright');
    expect(detectFormat('report', JSON.stringify(playwrightReport('/x')))).toBe('playwright');
    expect(detectFormat('r.json', '[{"caseId":1,"result":"Passed"}]')).toBe('g7b');
    expect(detectFormat('r.json', '{"results":[{"caseId":1,"result":"Failed"}]}')).toBe('g7b');
  });

  it('refuses content that is neither', () => {
    expect(() => detectFormat('r.json', '{"foo":1}')).toThrow(/无法识别/);
    expect(() => detectFormat('r.log', 'plain text')).toThrow(/无法识别/);
  });
});

describe('report parsing', () => {
  it('walks nested Playwright suites, maps statuses and keeps attachment paths', () => {
    const r = parsePlaywright(JSON.stringify(playwrightReport('/ci/test-results')));
    expect(r.cases).toEqual([
      { name: '[chromium] Login › user can log in', status: 'passed', flaky: undefined },
      { name: '[chromium] Login › wrong password shows error', status: 'failed', flaky: undefined },
      { name: '[chromium] Login › remember me', status: 'passed', flaky: true },
      { name: '[chromium] Login › sso', status: 'skipped', flaky: undefined },
    ]);
    expect(r.attachments).toHaveLength(2);
    expect(r.attachments[0]).toMatchObject({
      path: '/ci/test-results/login-wrong-password-chromium/test-failed-1.png',
      caseName: '[chromium] Login › wrong password shows error',
      titlePath: ['Login', 'wrong password shows error'],
      specFile: 'login.spec.ts',
    });
  });

  it('reads JUnit testcases: self-closing = passed, failure/error = failed, skipped', () => {
    const r = parseJunit(JUNIT);
    expect(r.cases.map((c) => `${c.name}:${c.status}`)).toEqual([
      'OrderApiTest › createOrder:passed',
      'OrderApiTest › cancelOrder:failed',
      'OrderApiTest › refund:failed',
      'OrderApiTest › archive:skipped',
    ]);
  });

  it('counts the stats and enforces the 2000-result cap and non-empty reports', () => {
    expect(parseReport('r.xml', JUNIT).stats).toEqual({ total: 4, passed: 1, failed: 2, skipped: 1, flaky: 0 });
    expect(parseReport('r.json', JSON.stringify(playwrightReport('/x'))).stats).toEqual({ total: 4, passed: 2, failed: 1, skipped: 1, flaky: 1 });
    const many = `<testsuite>${'<testcase name="t"/>'.repeat(MAX_RESULTS + 1)}</testsuite>`;
    expect(() => parseReport('r.xml', many)).toThrow(/分批/);
    expect(() => parseReport('r.xml', '<testsuites></testsuites>')).toThrow(/没有任何用例/);
  });
});

describe('validateUploadOptions', () => {
  const base = () => ({ project: '7', type: 'e2e', report: write('report.json', '{}') });

  it('normalises ids and keeps optional fields', () => {
    const v = validateUploadOptions({ ...base(), run: '11', step: '12', task: '13', testRound: '14', env: 'staging', build: 'abc', autoBug: true });
    expect(v).toMatchObject({ projectId: 7, testType: 'e2e', runId: 11, stepId: 12, taskId: 13, planId: 14, environment: 'staging', buildRef: 'abc', autoBug: true });
  });

  it('rejects bad type / env / format / ids', () => {
    expect(() => validateUploadOptions({ ...base(), type: 'smoke' })).toThrow(/--type/);
    expect(() => validateUploadOptions({ ...base(), env: 'qa' })).toThrow(/--env/);
    expect(() => validateUploadOptions({ ...base(), format: 'allure' })).toThrow(/--format/);
    expect(() => validateUploadOptions({ ...base(), project: 'abc' })).toThrow(/--project/);
    expect(() => validateUploadOptions({ ...base(), task: '-1' })).toThrow(/--task/);
  });

  it('needs --run and --step together', () => {
    expect(() => validateUploadOptions({ ...base(), run: '1' })).toThrow(/同时/);
    expect(() => validateUploadOptions({ ...base(), step: '1' })).toThrow(/同时/);
  });

  it('checks the report and screenshots paths and the 20 MB report cap', () => {
    expect(() => validateUploadOptions({ ...base(), report: path.join(dir, 'nope.json') })).toThrow(/不存在/);
    expect(() => validateUploadOptions({ ...base(), report: sparse('big.json', 20 * 1024 * 1024 + 1) })).toThrow(/20 MB/);
    expect(() => validateUploadOptions({ ...base(), screenshots: write('file.png') })).toThrow(/截图目录/);
  });
});

describe('collectScreenshots', () => {
  it('keeps only images, skips > 20 MB, flattens names and maps by attachment path', () => {
    const shots = path.join(dir, 'test-results');
    write('test-results/login-wrong-password-chromium/test-failed-1.png');
    write('test-results/other-case-chromium/test-failed-1.png');
    write('test-results/login-wrong-password-chromium/trace.zip');
    write('test-results/login-wrong-password-chromium/error-context.md');
    sparse('test-results/huge.jpg', 20 * 1024 * 1024 + 1);
    const report = parsePlaywright(JSON.stringify(playwrightReport(shots)));

    const r = collectScreenshots(shots, report.attachments);

    expect(r.files.map((f) => f.uploadName)).toEqual([
      'login-wrong-password-chromium__test-failed-1.png',
      'other-case-chromium__test-failed-1.png',
    ]);
    expect(r.files[0]).toMatchObject({ caseName: '[chromium] Login › wrong password shows error', contentType: 'image/png' });
    expect(r.files[1].caseName).toBeUndefined();
    expect(r.skippedNonImage).toBe(2);
    expect(r.warnings).toEqual([expect.stringMatching(/huge\.jpg.*20 MB/)]);
  });

  it('falls back to the last two path segments when the report came from another machine', () => {
    write('shots/login-wrong-password-chromium/test-failed-1.png');
    const report = parsePlaywright(JSON.stringify(playwrightReport('/home/runner/work/app/test-results')));
    const r = collectScreenshots(path.join(dir, 'shots'), report.attachments);
    expect(r.files[0].caseName).toBe('[chromium] Login › wrong password shows error');
  });

  it(`caps evidence at ${MAX_EVIDENCE_PER_CASE} per case`, () => {
    const attachments = Array.from({ length: MAX_EVIDENCE_PER_CASE + 1 }, (_, i) => ({
      path: write(`s/case-a/shot-${String(i).padStart(2, '0')}.png`),
      caseName: 'A',
      titlePath: ['A'],
    }));
    const r = collectScreenshots(path.join(dir, 's'), attachments);
    expect(r.files).toHaveLength(MAX_EVIDENCE_PER_CASE);
    expect(r.warnings).toHaveLength(1);
  });
});

describe('buildImportMeta', () => {
  it('drops empty fields, marks CLI as source and maps the wire format', () => {
    const v = validateUploadOptions({ project: '7', type: 'api', report: write('r.xml', JUNIT) });
    expect(buildImportMeta(v, parseReport('r.xml', JUNIT), [])).toEqual({
      projectId: 7, testType: 'api', source: 'CLI', reportFormat: 'junit_xml',
    });
  });
});

describe('test-run upload (CLI)', () => {
  const upload = (args: string[]) => runCli(registerTestRunCommands, ['test-run', 'upload', ...args]);
  const RESPONSE = {
    run: { id: 501, runNo: 'TR-12', testType: 'e2e', sourceType: 'AUTOMATION_STEP' },
    summary: { total: 4, passed: 2, failed: 1, blocked: 0, skipped: 1, flaky: 1 },
    unmatched: 3, createdBugIds: [88], reusedBugIds: [], evidenceCount: 2, attachedToStep: true,
    gate: { verdict: 'FAIL', buildRef: 'abc', ruleOutcomes: [{ met: false, level: 'blocking', message: 'P0 用例全部通过' }] },
  };

  it('sends meta + report + screenshots in one multipart call and prints the summary; exits 2 on failures', async () => {
    const shots = path.join(dir, 'test-results');
    write('test-results/login-wrong-password-chromium/test-failed-1.png');
    write('test-results/z-other/after.webp');
    const report = write('report.json', JSON.stringify(playwrightReport(shots)));
    const spy = vi.spyOn(apiClient, 'uploadMultipart').mockResolvedValue(RESPONSE);

    const r = await upload(['--project', '7', '--type', 'e2e', '--report', report, '--screenshots', shots,
      '--run', '31', '--step', '32', '--task', '33', '--env', 'test', '--build', 'abc', '--auto-bug']);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, parts, opts] = spy.mock.calls[0];
    expect(url).toBe('/qc/runs/import');
    expect(opts).toEqual({ timeoutMs: 300000 });
    expect(parts[0]).toEqual({
      name: 'meta',
      json: {
        projectId: 7, testType: 'e2e', source: 'AUTOMATION_STEP', runId: 31, stepId: 32, taskId: 33,
        environment: 'test', envTag: 'test', buildRef: 'abc', reportFormat: 'playwright_json', autoBug: true,
        evidenceMap: [
          {
            file: 'login-wrong-password-chromium__test-failed-1.png', kind: 'screenshot',
            caseName: '[chromium] Login › wrong password shows error',
            titlePath: ['Login', 'wrong password shows error'], specFile: 'login.spec.ts',
          },
          { file: 'z-other__after.webp', kind: 'screenshot' },
        ],
      },
    });
    expect(parts[1]).toEqual({ name: 'report', filePath: report, contentType: 'application/json' });
    expect(parts.slice(2).map((p) => [p.name, p.fileName, p.contentType])).toEqual([
      ['evidence', 'login-wrong-password-chromium__test-failed-1.png', 'image/png'],
      ['evidence', 'z-other__after.webp', 'image/webp'],
    ]);

    expect(r.stdout).toContain('截图 2 张（按附件路径对上用例 1 张）');
    expect(r.stdout).toContain('TR-12  (ID 501)');
    expect(r.stdout).toContain('通过 2  失败 1  跳过 1');
    expect(r.stdout).toContain('证据 2 个  未匹配用例 3 条');
    expect(r.stdout).toContain('新建 Bug: 88');
    expect(r.stdout).toContain('已挂到自动化步骤');
    expect(r.stdout).toContain('质量门禁：不通过');
    expect(r.exitCode).toBe(2);
  });

  it('exits 0 when everything passed, and --json prints the server response', async () => {
    const report = write('junit.xml', '<testsuite><testcase name="a"/></testsuite>');
    const spy = vi.spyOn(apiClient, 'uploadMultipart').mockResolvedValue({ run: { id: 1 }, summary: { total: 1, passed: 1, failed: 0 } });
    const r = await upload(['--project', '7', '--type', 'unit', '--report', report, '--json']);
    expect(spy.mock.calls[0][1][0].json).toEqual({ projectId: 7, testType: 'unit', source: 'CLI', reportFormat: 'junit_xml' });
    expect(spy.mock.calls[0][1][1].contentType).toBe('application/xml');
    expect(JSON.parse(r.stdout)).toEqual({ run: { id: 1 }, summary: { total: 1, passed: 1, failed: 0 } });
    expect(r.exitCode).toBeUndefined();
  });

  it('refuses bad arguments or an unreadable report before any request', async () => {
    const spy = vi.spyOn(apiClient, 'uploadMultipart').mockResolvedValue({});
    const bad = write('bad.json', '{"foo":1}');
    for (const args of [
      ['--project', '7', '--type', 'smoke', '--report', bad],
      ['--project', '7', '--type', 'e2e', '--report', bad],
      ['--project', '7', '--type', 'e2e', '--report', bad, '--step', '3'],
      ['--type', 'e2e', '--report', bad],
    ]) {
      const r = await upload(args);
      expect(r.exitCode).toBe(1);
      expect(noHttpCalls(r)).toBe(true);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('turns a server parse failure into exit 1 with the message', async () => {
    const report = write('junit.xml', '<testsuite><testcase name="a"/></testsuite>');
    const err: any = new Error('测试报告解析失败');
    err.code = 2728;
    vi.spyOn(apiClient, 'uploadMultipart').mockRejectedValue(err);
    const r = await upload(['--project', '7', '--type', 'unit', '--report', report]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('测试报告解析失败');
  });
});

describe('test-run latest (CLI)', () => {
  const latest = (args: string[], response = ok(null)) => runCli(registerTestRunCommands, ['test-run', 'latest', ...args], response);

  it('queries by step and shows the stats, failures and evidence', async () => {
    const r = await latest(['--project', '7', '--step', '32'], ok({
      run: { id: 501, runNo: 'TR-12', testType: 'e2e', status: 'Finished', sourceType: 'AUTOMATION_STEP' },
      summary: { total: 4, passed: 3, failed: 1, skipped: 0 },
      failures: [{ externalName: 'Login › wrong password', failureMessage: 'expected 401\nat …' }],
      evidence: [{ fileName: 'test-failed-1.png' }],
    }));
    expect(r.http.get).toHaveBeenCalledWith('/qc/runs/latest', { params: { projectId: 7, stepId: 32 } });
    expect(r.stdout).toContain('TR-12  e2e  Finished');
    expect(r.stdout).toContain('通过 3  失败 1');
    expect(r.stdout).toContain('✗ Login › wrong password  expected 401');
    expect(r.stdout).toContain('test-failed-1.png');
  });

  it('says so when there is no run yet', async () => {
    const r = await latest(['--task', '33']);
    expect(r.http.get).toHaveBeenCalledWith('/qc/runs/latest', { params: { taskId: 33 } });
    expect(r.stdout).toContain('暂无测试运行');
  });

  it('rejects --task with --step, or no filter at all', async () => {
    for (const args of [['--task', '1', '--step', '2'], []]) {
      const r = await latest(args);
      expect(r.exitCode).toBe(1);
      expect(noHttpCalls(r)).toBe(true);
    }
  });
});

describe('command layout', () => {
  it('exposes the same upload / latest under qc run and top-level test-run', async () => {
    for (const args of [['qc', 'run', 'upload', '--help'], ['test-run', 'upload', '--help']]) {
      const r = await runCli(registerQcCommands, args);
      expect(r.stdout).toContain('--screenshots <dir>');
      expect(r.stdout).toContain('--auto-bug');
    }
    const r = await runCli(registerQcCommands, ['qc', 'run', 'latest', '--help']);
    expect(r.stdout).toContain('--step <stepId>');
  });
});

describe('ApiClient.uploadMultipart', () => {
  it('sends the meta part as application/json and files under their chosen names', async () => {
    const report = write('report.json', '{}');
    const shot = write('a/test-failed-1.png', 'png');
    const post = vi.spyOn(apiClient['instance'], 'post').mockResolvedValue({ data: ok({ run: { id: 1 } }) } as never);

    const r = await apiClient.uploadMultipart('/qc/runs/import', [
      { name: 'meta', json: { projectId: 7 } },
      { name: 'report', filePath: report, contentType: 'application/json' },
      { name: 'evidence', filePath: shot, fileName: 'a__test-failed-1.png', contentType: 'image/png' },
    ], { timeoutMs: 1234 });

    expect(r).toEqual({ run: { id: 1 } });
    const [url, form, config] = post.mock.calls[0] as any[];
    expect(url).toBe('/qc/runs/import');
    expect(config.timeout).toBe(1234);
    expect(config.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(Number(config.headers['Content-Length'])).toBe((form as any).getLengthSync());
    const headers = (form as any)._streams.filter((s: unknown) => typeof s === 'string').join('');
    expect(headers).toMatch(/name="meta"[\s\S]*Content-Type: application\/json/);
    expect(headers).toContain('{"projectId":7}');
    expect(headers).toMatch(/name="report"; filename="report.json"/);
    expect(headers).toMatch(/name="evidence"; filename="a__test-failed-1.png"\r\nContent-Type: image\/png/);
  });
});
