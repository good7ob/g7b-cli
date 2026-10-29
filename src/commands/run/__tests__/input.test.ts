import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InputError } from '../../../utils/cliHelpers';
import { AgentState, IDLE } from '../../agent/state';
import {
  SEGMENT_MAX, artifactItem, chunkLog, describeRunError, diffSummary, doneBody, failBody, maskSecrets, operationBody,
  parseArtifactSpec, parseFilesJson, parseNameStatusZ, parseNumstatZ, parseTokens, parseToolCallsJsonl, resolveTarget,
  stepLost, workRecordRunLink, batches,
} from '../input';
import { gitDiffSummary, realGit } from '../steps';

const busy = (extra: Partial<AgentState & Record<string, unknown>> = {}): AgentState =>
  ({ status: 'busy', taskId: 11, taskNo: 'T11', name: 'dev', projectId: 5, claimedAt: 'a', deadline: 'b', runId: 3, stepId: 45, nodeCode: 'DEV', ...extra } as AgentState);
const err = (code: number, msg: string) => Object.assign(new Error(msg), { code });

describe('resolveTarget', () => {
  it('defaults run and step to the busy slot', () => {
    expect(resolveTarget({}, busy())).toEqual({ runId: 3, stepId: 45, fromSlot: true });
    expect(resolveTarget({}, busy({ orgId: 58 }))).toEqual({ runId: 3, stepId: 45, fromSlot: true, orgId: 58 });
  });

  it('fills the missing half from the slot when the given half matches it', () => {
    expect(resolveTarget({ step: '45' }, busy())).toMatchObject({ runId: 3, stepId: 45, fromSlot: true });
    expect(resolveTarget({ run: '3' }, busy())).toMatchObject({ runId: 3, stepId: 45, fromSlot: true });
  });

  it('explicit run + step other than the slot: not from the slot (no counter, no slot release)', () => {
    expect(resolveTarget({ run: '9', step: '90' }, busy({ orgId: 58 }))).toEqual({ runId: 9, stepId: 90, fromSlot: false });
    expect(resolveTarget({ run: '3', step: '45' }, IDLE)).toEqual({ runId: 3, stepId: 45, fromSlot: false });
  });

  it('refuses incomplete targets', () => {
    expect(() => resolveTarget({}, IDLE)).toThrow(/本地工作槽没有运行步骤/);
    expect(() => resolveTarget({}, busy({ stepId: null, runId: null }))).toThrow(InputError);
    expect(() => resolveTarget({ step: '46' }, busy())).toThrow(/缺少 --run/);
    expect(() => resolveTarget({ run: '4' }, busy())).toThrow(/缺少 --step/);
    expect(() => resolveTarget({ run: 'x', step: '1' }, IDLE)).toThrow(/--run 必须是正整数/);
  });
});

describe('chunkLog', () => {
  it('keeps small text as one segment, empty as none', () => {
    expect(chunkLog('hello\n')).toEqual(['hello\n']);
    expect(chunkLog('')).toEqual([]);
  });

  it('splits > 1 MB into ≤ 1 MB segments that join back to the input, cutting at line breaks', () => {
    const line = `${'x'.repeat(99)}\n`; // 100 bytes
    const text = line.repeat(26_000); // 2.6 MB
    const parts = chunkLog(text);
    expect(parts.length).toBe(3);
    parts.forEach((p) => {
      expect(Buffer.byteLength(p)).toBeLessThanOrEqual(SEGMENT_MAX);
      expect(p.endsWith('\n')).toBe(true);
    });
    expect(parts.join('')).toBe(text);
  });

  it('never cuts inside a multi-byte character when there is no line break', () => {
    const text = '中文日志'.repeat(10); // 3 bytes per char, no newline
    const parts = chunkLog(text, 10);
    parts.forEach((p) => {
      expect(Buffer.byteLength(p)).toBeLessThanOrEqual(10);
      expect(p).not.toContain('�');
    });
    expect(parts.join('')).toBe(text);
  });
});

describe('maskSecrets', () => {
  it('masks keys, tokens, passwords, bearer headers, private keys and URL credentials', () => {
    const raw = [
      'export API_KEY=abcd1234efgh',
      'password: hunter22',
      '"client_secret": "s3cr3t-value"',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmn',
      'gh token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'anthropic sk-ant-api03-abcdefghijklmnopqrstuvwx',
      'aws AKIAABCDEFGHIJKLMNOP',
      'git clone https://user:pa55word@github.com/o/r.git',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
      'plain line stays',
    ].join('\n');
    const out = maskSecrets(raw);
    for (const leaked of ['abcd1234efgh', 'hunter22', 's3cr3t-value', 'eyJzdWIi', 'ghp_abc', 'sk-ant-api03', 'AKIAABCDEFGHIJKLMNOP', 'pa55word', 'MIIEow']) {
      expect(out).not.toContain(leaked);
    }
    expect(out).toContain('API_KEY=***');
    expect(out).toContain('https://user:***@github.com/o/r.git');
    expect(out).toContain('plain line stays');
  });
});

describe('git numstat parsing', () => {
  // git diff --numstat -z -M / --name-status -z -M outputs for: modified, added, deleted, renamed, binary
  const numstat = ['3\t1\tsrc/a.ts', '10\t0\tsrc/new.ts', '0\t7\tsrc/old.ts', '2\t2\t', 'src/before.ts', 'src/after.ts', '-\t-\tlogo.png', ''].join('\0');
  const names = ['M', 'src/a.ts', 'A', 'src/new.ts', 'D', 'src/old.ts', 'R087', 'src/before.ts', 'src/after.ts', 'M', 'logo.png', ''].join('\0');

  it('parses numstat -z incl. renames and binary files', () => {
    expect(parseNumstatZ(numstat)).toEqual([
      { path: 'src/a.ts', added: 3, deleted: 1 },
      { path: 'src/new.ts', added: 10, deleted: 0 },
      { path: 'src/old.ts', added: 0, deleted: 7 },
      { path: 'src/after.ts', oldPath: 'src/before.ts', added: 2, deleted: 2 },
      { path: 'logo.png', added: 0, deleted: 0 },
    ]);
    expect(parseNameStatusZ(names).get('src/after.ts')).toBe('R');
  });

  it('joins into FileItem rows (paths and counts only)', () => {
    expect(diffSummary(numstat, names, 'https://github.com/o/r/pull/9')).toEqual([
      { path: 'src/a.ts', changeType: 'M', linesAdded: 3, linesDeleted: 1, prUrl: 'https://github.com/o/r/pull/9' },
      { path: 'src/new.ts', changeType: 'A', linesAdded: 10, linesDeleted: 0, prUrl: 'https://github.com/o/r/pull/9' },
      { path: 'src/old.ts', changeType: 'D', linesAdded: 0, linesDeleted: 7, prUrl: 'https://github.com/o/r/pull/9' },
      { path: 'src/after.ts', changeType: 'R', linesAdded: 2, linesDeleted: 2, oldPath: 'src/before.ts', prUrl: 'https://github.com/o/r/pull/9' },
      { path: 'logo.png', changeType: 'M', linesAdded: 0, linesDeleted: 0, prUrl: 'https://github.com/o/r/pull/9' },
    ]);
  });

  it('works on a real git repository (base...HEAD)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-git-'));
    const g = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf-8' });
    try {
      g('init', '-q', '-b', 'main');
      g('config', 'user.email', 't@t');
      g('config', 'user.name', 't');
      fs.writeFileSync(path.join(dir, 'keep.txt'), 'a\nb\nc\n');
      fs.writeFileSync(path.join(dir, 'gone.txt'), 'x\ny\n');
      fs.writeFileSync(path.join(dir, 'move.txt'), Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n');
      g('add', '.');
      g('commit', '-qm', 'base');
      g('checkout', '-qb', 'feat/x');
      fs.writeFileSync(path.join(dir, 'keep.txt'), 'a\nB\nc\nd\n');
      fs.unlinkSync(path.join(dir, 'gone.txt'));
      fs.writeFileSync(path.join(dir, 'secret.env'), 'TOKEN=should-never-leave\n');
      g('mv', 'move.txt', 'moved.txt');
      g('add', '-A');
      g('commit', '-qm', 'change');
      const r = gitDiffSummary((args) => realGit(['-C', dir, ...args]), 'main');
      expect(r.branch).toBe('feat/x');
      expect(r.commitRange).toMatch(/^[0-9a-f]{12}\.\.[0-9a-f]{12}$/);
      expect(r.files).toEqual(
        expect.arrayContaining([
          { path: 'keep.txt', changeType: 'M', linesAdded: 2, linesDeleted: 1 },
          { path: 'gone.txt', changeType: 'D', linesAdded: 0, linesDeleted: 2 },
          { path: 'secret.env', changeType: 'A', linesAdded: 1, linesDeleted: 0 },
          { path: 'moved.txt', changeType: 'R', linesAdded: 0, linesDeleted: 0, oldPath: 'move.txt' },
        ])
      );
      expect(r.files).toHaveLength(4);
      expect(JSON.stringify(r)).not.toContain('should-never-leave');
      expect(() => gitDiffSummary((args) => realGit(['-C', dir, ...args]), 'no-such-base')).toThrow(/git diff no-such-base...HEAD 失败/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--files JSON is validated', () => {
    expect(parseFilesJson('[{"path":"a.ts","changeType":"added","linesAdded":3}]')).toEqual([{ path: 'a.ts', changeType: 'A', linesAdded: 3, linesDeleted: 0 }]);
    expect(() => parseFilesJson('{}')).toThrow(/必须是数组/);
    expect(() => parseFilesJson('[{"path":"a","changeType":"X"}]')).toThrow(/A \/ M \/ D \/ R/);
    expect(() => parseFilesJson('[{"path":"a","linesAdded":-1}]')).toThrow(/非负整数/);
  });
});

describe('parseToolCallsJsonl', () => {
  it('maps {tool, startedAt, durationMs, ok, note} to the backend item, masking and cutting the note', () => {
    const text = [
      '{"tool":"Bash","startedAt":"2026-10-29T10:00:00+09:00","durationMs":1200,"ok":true,"note":"npm test TOKEN=abc12345"}',
      '',
      '{"toolName":"Edit","startedAt":"2026-10-29T10:00:05Z","durationMs":30,"result":"error","summary":"' + 'x'.repeat(300) + '"}',
      '{"tool":"Read","startedAt":"2026-10-29T10:00:06Z"}',
    ].join('\n');
    const items = parseToolCallsJsonl(text);
    expect(items[0]).toEqual({ toolName: 'Bash', startedAt: '2026-10-29T10:00:00+09:00', durationMs: 1200, result: 'ok', summary: 'npm test TOKEN=***' });
    expect(items[1].result).toBe('error');
    expect(items[1].summary).toHaveLength(200);
    expect(items[2]).toEqual({ toolName: 'Read', startedAt: '2026-10-29T10:00:06Z', durationMs: 0, result: 'ok' });
  });

  it('reports the bad line', () => {
    expect(() => parseToolCallsJsonl('{"tool":"a","startedAt":"2026-10-29T10:00:00Z"}\nnot json')).toThrow(/第 2 行 不是合法 JSON/);
    expect(() => parseToolCallsJsonl('{"startedAt":"2026-10-29T10:00:00Z"}')).toThrow(/第 1 行 缺少 tool/);
    expect(() => parseToolCallsJsonl('{"tool":"a","startedAt":"yesterday"}')).toThrow(/startedAt/);
    expect(() => parseToolCallsJsonl('{"tool":"a","startedAt":"2026-10-29T10:00:00Z","ok":"yes"}')).toThrow(/ok 必须是/);
  });

  it('batches at 500', () => {
    expect(batches(Array.from({ length: 1201 }, (_, i) => i)).map((b) => b.length)).toEqual([500, 500, 201]);
  });
});

describe('artifacts', () => {
  it('PR → PULL_REQUEST, numeric ref → id, URL → url', () => {
    expect(artifactItem('PR', 'https://github.com/o/r/pull/42', 'feat x')).toEqual({ type: 'PULL_REQUEST', url: 'https://github.com/o/r/pull/42', title: 'feat x' });
    expect(artifactItem('test_run', '7')).toEqual({ type: 'TEST_RUN', id: 7 });
    expect(artifactItem('review-report', '12')).toEqual({ type: 'REVIEW_REPORT', id: 12 });
    expect(parseArtifactSpec('EXTERNAL:https://ci.example.com/b/1')).toEqual({ type: 'EXTERNAL', url: 'https://ci.example.com/b/1' });
    expect(() => artifactItem('DOC', '1')).toThrow(/--type 取值无效/);
    expect(() => artifactItem('PR', 'not-a-url')).toThrow(/--ref/);
    expect(() => parseArtifactSpec('TEST_RUN')).toThrow(/<type>:<id\|url>/);
  });
});

describe('done / fail bodies', () => {
  it('done: summary, PRs, artifacts, tokens, files; partial → prefix', () => {
    expect(doneBody({ summary: '实现完成', pr: ['https://github.com/o/r/pull/1'], tokens: '1500', artifact: ['TEST_RUN:7'] })).toEqual({
      summary: '实现完成',
      prUrls: ['https://github.com/o/r/pull/1'],
      artifacts: [{ type: 'TEST_RUN', id: 7 }],
      tokens: { input: 1500 },
    });
    expect(doneBody({ summary: '只做了一半', result: 'partial' }).summary).toBe('[partial] 只做了一半');
    expect(doneBody({})).toEqual({});
    expect(doneBody({ tokens: '{"input":10,"output":5}' }, [{ path: 'a', changeType: 'M', linesAdded: 1, linesDeleted: 0 }])).toEqual({
      tokens: { input: 10, output: 5 },
      files: [{ path: 'a', changeType: 'M', linesAdded: 1, linesDeleted: 0 }],
    });
    expect(() => doneBody({ result: 'half' })).toThrow(/--result/);
    expect(() => doneBody({ summary: 'x'.repeat(501) })).toThrow(/500/);
    expect(() => doneBody({ pr: ['github.com/o/r/pull/1'] })).toThrow(/--pr/);
    expect(() => parseTokens('{"total":1}')).toThrow(/多余: total/);
  });

  it('fail: free text → OTHER / AGENT_ERROR (--retryable); a code as --reason or --code is kept', () => {
    expect(failBody({ reason: '依赖服务不可用' })).toEqual({ reason: 'OTHER', message: '依赖服务不可用' });
    expect(failBody({ reason: 'npm registry 超时', retryable: true })).toEqual({ reason: 'AGENT_ERROR', message: 'npm registry 超时' });
    expect(failBody({ reason: 'TEST_FAILED', message: '3 个用例失败' })).toEqual({ reason: 'TEST_FAILED', message: '3 个用例失败' });
    expect(failBody({ reason: '需要产品确认字段口径', code: 'blocked' })).toEqual({ reason: 'BLOCKED', message: '需要产品确认字段口径' });
    expect(failBody({ reason: 'leaked password=abc123' }).message).toBe('leaked password=***');
    expect(() => failBody({ reason: 'x', code: 'NOPE' })).toThrow(/--code/);
    expect(() => failBody({ reason: ' ' })).toThrow(/--reason/);
  });

  it('operations carry the version; cancel / abandon need a reason', () => {
    expect(operationBody('pause', 4)).toEqual({ version: 4 });
    expect(operationBody('halt', 4, '误触发')).toEqual({ version: 4, reason: '误触发' });
    expect(operationBody('cancel', 4, '不需要了')).toEqual({ version: 4, reason: '不需要了' });
    expect(() => operationBody('cancel', 4)).toThrow(/--reason/);
    expect(() => operationBody('pause', undefined)).toThrow(/version/);
  });
});

describe('describeRunError', () => {
  it('maps the run codes to readable text and keeps the server message', () => {
    expect(describeRunError(err(2718, 'RUNNER_KEY_REQUIRED: 步骤回报只接受 AI 员工 Key'))).toMatch(/^步骤回报只接受 AI 员工 Key：当前是人类账号的 Key.*\[2718: RUNNER_KEY_REQUIRED/);
    expect(describeRunError(err(2719, 'STEP_CLOSED: 步骤已于 … 结束超过 10 分钟'))).toMatch(/^步骤已结束超过 10 分钟，不再接受回报/);
    expect(describeRunError(err(2722, 'LOG_LIMIT_EXCEEDED: …'))).toMatch(/50 MB 上限/);
    expect(describeRunError(err(2000, 'STEP_NOT_HELD: 该步骤不是分配给本 AI 员工的（emp:7）'))).toMatch(/^该步骤不是分配给本 AI 员工的（可能已被改派/);
    expect(describeRunError(err(2000, 'RUN_NOT_VISIBLE: 无权查看该运行'))).toMatch(/^无权查看该运行（/);
    expect(describeRunError(err(2703, 'AUTOMATION_AI_FORBIDDEN'))).toMatch(/AI 员工 Key 不能操作运行/);
    expect(describeRunError(err(2723, 'RUN_VERSION_CONFLICT: 运行已被他人更新（当前 version 5）'))).toMatch(/version 冲突.*重新执行/);
    expect(describeRunError(err(2000, '没有权限'))).toBe('没有权限 (code=2000)');
    expect(describeRunError(new Error('socket hang up'))).toBe('socket hang up');
    expect(stepLost(err(2000, 'STEP_NOT_HELD: x'))).toBe(true);
    expect(stepLost(err(2719, 'STEP_CLOSED'))).toBe(true);
    expect(stepLost(err(2722, 'LOG_LIMIT_EXCEEDED'))).toBe(false);
  });
});

describe('workRecordRunLink (log save)', () => {
  it('defaults run / step / node / task from a slot holding a step', () => {
    expect(workRecordRunLink({}, busy())).toEqual({ runId: 3, stepId: 45, nodeCode: 'DEV', taskId: 11, fromSlot: true });
    expect(workRecordRunLink({ taskId: '11' }, busy())).toEqual({ runId: 3, stepId: 45, nodeCode: 'DEV', fromSlot: true });
  });

  it('does not attach for another task, --no-run-link, an idle slot or a slot without a step', () => {
    expect(workRecordRunLink({ taskId: '12' }, busy())).toEqual({ fromSlot: false });
    expect(workRecordRunLink({ runLink: false }, busy())).toEqual({ fromSlot: false });
    expect(workRecordRunLink({}, IDLE)).toEqual({ fromSlot: false });
    expect(workRecordRunLink({}, busy({ stepId: null }))).toEqual({ fromSlot: false });
    expect(workRecordRunLink({}, null)).toEqual({ fromSlot: false });
  });

  it('explicit flags win and are validated', () => {
    expect(workRecordRunLink({ runId: '9', stepId: '90', nodeCode: 'TEST' }, busy())).toEqual({ runId: 9, stepId: 90, nodeCode: 'TEST', fromSlot: false });
    expect(() => workRecordRunLink({ stepId: 'abc' }, null)).toThrow(/--step-id/);
  });
});
