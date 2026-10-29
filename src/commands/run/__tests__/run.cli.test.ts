import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { registerRunCommands, io } from '../index';
import { registerAgentCommands } from '../../agent';
import { registerLogCommands } from '../../log';
import { Envelope, bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { AgentState, AgentStateStore } from '../../agent/state';

// Same isolation as agent.cli.test: mock os.homedir so nothing touches the real ~/.good7ob.
vi.mock('os', async () => {
  const actual = (await vi.importActual('os')) as typeof import('os');
  const homedir = () => (globalThis as { __agentTestHome?: string }).__agentTestHome ?? '/nonexistent-test-home';
  return { ...actual, default: { ...actual, homedir }, homedir };
});

let tmpHome: string;
const savedOrg = process.env.GOOD7OB_ORG_ID;
const store = () => new AgentStateStore(path.join(tmpHome, '.good7ob'));
const slot = (extra: Record<string, unknown> = {}): AgentState =>
  ({ status: 'busy', taskId: 11, taskNo: 'T11', name: 'dev step', projectId: 5, claimedAt: '2026-10-29T00:00:00.000Z', deadline: '2099-01-01T00:00:00.000Z', assignmentId: 9, runId: 3, stepId: 45, nodeCode: 'DEV', orgId: 58, ...extra } as AgentState);
const STEP = '/api/v1/orgs/58/runs/3/steps/45';
const all = (register: Array<(p: Command) => void>) => (p: Command) => register.forEach((r) => r(p));
const cli = all([registerRunCommands, registerAgentCommands, registerLogCommands]);
const posts = (r: Awaited<ReturnType<typeof runCli>>) => r.http.post.mock.calls.map((c) => [c[0], c[1]]);

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'run-cli-'));
  (globalThis as { __agentTestHome?: string }).__agentTestHome = tmpHome;
  delete process.env.GOOD7OB_ORG_ID;
});
afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  if (savedOrg === undefined) delete process.env.GOOD7OB_ORG_ID;
  else process.env.GOOD7OB_ORG_ID = savedOrg;
  vi.restoreAllMocks();
});

describe('run log append', () => {
  it('defaults run / step / org from the slot, starts after the server\'s last seq, then continues the local counter', async () => {
    store().write(slot());
    const first = await runCli(cli, ['run', 'log', 'append', '--text', 'build ok\n'], (m, url) =>
      m === 'get' ? ok({ items: [{ seq: 4 }], next: 4 }) : ok({ seq: 5, bytes: 9, totalBytes: 109, truncated: false, duplicate: false })
    );
    expect(first.exitCode).toBeUndefined();
    expect(first.http.get).toHaveBeenCalledWith(`${STEP}/logs`, expect.objectContaining({ params: { limit: 1 } }));
    expect(posts(first)).toEqual([[`${STEP}/logs`, { seq: 5, content: 'build ok\n' }]]);
    expect(first.stdout).toContain('✓ 运行 #3 步骤 #45 日志已上传 1 段（seq 5，9 字节；步骤累计 109 字节）');
    expect(store().read()).toMatchObject({ logSeq: 5 });

    const second = await runCli(cli, ['run', 'log', 'append', '--text', 'tests ok\n'], ok({ seq: 6, bytes: 9, totalBytes: 118 }));
    expect(second.http.get).not.toHaveBeenCalled();
    expect(posts(second)).toEqual([[`${STEP}/logs`, { seq: 6, content: 'tests ok\n' }]]);
    expect(store().read()).toMatchObject({ logSeq: 6 });
  });

  it('chunks a > 1 MB file into ≤ 1 MB sequential segments and masks secrets before upload', async () => {
    store().write(slot({ logSeq: 2 }));
    const file = path.join(tmpHome, 'out.log');
    fs.writeFileSync(file, `API_KEY=abcd1234efgh\n${`${'y'.repeat(199)}\n`.repeat(12_000)}`); // ~2.4 MB
    const r = await runCli(cli, ['run', 'log', 'append', '--file', file], ok({ duplicate: false }));
    expect(r.exitCode).toBeUndefined();
    const sent = posts(r);
    expect(sent.map(([, b]: any) => b.seq)).toEqual([3, 4, 5]);
    sent.forEach(([url, b]: any) => {
      expect(url).toBe(`${STEP}/logs`);
      expect(Buffer.byteLength(b.content)).toBeLessThanOrEqual(1024 * 1024);
    });
    expect((sent[0][1] as any).content.startsWith('API_KEY=***\n')).toBe(true);
    expect(sent.map(([, b]: any) => b.content).join('')).not.toContain('abcd1234efgh');
    expect(store().read()).toMatchObject({ logSeq: 5 });
  });

  it('--seq sets the first seq; --stdin reads standard input; duplicates are reported', async () => {
    store().write(slot({ logSeq: 9 }));
    vi.spyOn(io, 'readStdin').mockReturnValue('again\n');
    const r = await runCli(cli, ['run', 'log', 'append', '--stdin', '--seq', '7'], ok({ seq: 7, duplicate: true }));
    expect(posts(r)).toEqual([[`${STEP}/logs`, { seq: 7, content: 'again\n' }]]);
    expect(r.stdout).toContain('seq 7 服务端已存在（幂等，未重复写入）');
    expect(store().read()).toMatchObject({ logSeq: 9 }); // never moves backwards
  });

  it('explicit --run/--step of another step: seq from the server, org from GOOD7OB_ORG_ID, slot untouched', async () => {
    process.env.GOOD7OB_ORG_ID = '77';
    store().write(slot({ logSeq: 1 }));
    const r = await runCli(cli, ['run', 'log', 'append', '--run', '8', '--step', '80', '--text', 'x'], (m) => (m === 'get' ? ok({ items: [], next: 0 }) : ok({})));
    expect(posts(r)).toEqual([['/api/v1/orgs/77/runs/8/steps/80/logs', { seq: 1, content: 'x' }]]);
    expect(store().read()).toMatchObject({ logSeq: 1, stepId: 45 });
  });

  it('2722 mid-upload: friendly message and the idempotent retry hint', async () => {
    store().write(slot({ logSeq: 0 }));
    let n = 0;
    const file = path.join(tmpHome, 'big.log');
    fs.writeFileSync(file, `${'z'.repeat(99)}\n`.repeat(21_000)); // 2.1 MB → 3 segments
    const r = await runCli(cli, ['run', 'log', 'append', '--file', file], () => (++n === 2 ? bizError(2722, 'LOG_LIMIT_EXCEEDED: 步骤日志已达 50 MB，已标记截断，不再接收') : ok({})));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('✗ 上传日志失败: 该步骤日志已达 50 MB 上限，服务端已标记截断，不再接收；剩余日志只保留在本地 [2722');
    expect(r.stderr).toContain('已上传 1 段；失败于 seq 2。重试: 原命令加 --seq 1');
  });

  it('refuses without a step and without exactly one source, before any HTTP call', async () => {
    const noSlot = await runCli(cli, ['run', 'log', 'append', '--text', 'x']);
    expect(noSlot.exitCode).toBe(1);
    expect(noSlot.stderr).toContain('本地工作槽没有运行步骤');
    expect(noHttpCalls(noSlot)).toBe(true);
    store().write(slot());
    const two = await runCli(cli, ['run', 'log', 'append', '--text', 'x', '--stdin']);
    expect(two.stderr).toContain('只能给一个');
    expect(noHttpCalls(two)).toBe(true);
  });
});

describe('run step done / fail', () => {
  it('done posts the report to the slot\'s step and frees the slot', async () => {
    store().write(slot());
    const r = await runCli(cli, ['run', 'step', 'done', '--summary', '实现并提交 PR', '--pr', 'https://github.com/o/r/pull/42', '--tokens', '{"input":1200,"output":300}', '--artifact', 'TEST_RUN:7'], ok({ stepId: 45, status: 'succeeded', nextStep: { stepId: 46, nodeCode: 'TEST' }, taskStatus: 'awaiting_completion_approval', runStatus: 'running' }));
    expect(r.exitCode).toBeUndefined();
    expect(posts(r)).toEqual([[`${STEP}/done`, { summary: '实现并提交 PR', prUrls: ['https://github.com/o/r/pull/42'], artifacts: [{ type: 'TEST_RUN', id: 7 }], tokens: { input: 1200, output: 300 } }]]);
    expect(r.stdout).toBe('✓ 运行 #3 步骤 #45 已回报完成（succeeded），下一步: TEST #46，任务状态: awaiting_completion_approval，运行状态: running，本地工作槽已空闲');
    expect(store().read()).toEqual({ status: 'idle' });
  });

  it('done --from-git adds the diff summary (paths and counts), branch and commit range', async () => {
    store().write(slot());
    vi.spyOn(io, 'git').mockImplementation((args: string[]) => {
      if (args[1] === '--numstat') return '5\t2\tsrc/a.ts\0';
      if (args[1] === '--name-status') return 'M\0src/a.ts\0';
      if (args[0] === 'merge-base') return 'aaaaaaaaaaaaaaaa\n';
      if (args[0] === 'rev-parse' && args[1] === '--short=12') return 'bbbbbbbbbbbb\n';
      return 'feat/x\n';
    });
    const r = await runCli(cli, ['run', 'step', 'done', '--from-git', 'origin/dev', '--pr', 'https://github.com/o/r/pull/42'], ok({ status: 'succeeded' }));
    expect(io.git).toHaveBeenCalledWith(['diff', '--numstat', '-z', '-M', 'origin/dev...HEAD']);
    expect(posts(r)[0][1]).toEqual({
      prUrls: ['https://github.com/o/r/pull/42'],
      branch: 'feat/x',
      commitRange: 'aaaaaaaaaaaa..bbbbbbbbbbbb',
      files: [{ path: 'src/a.ts', changeType: 'M', linesAdded: 5, linesDeleted: 2, prUrl: 'https://github.com/o/r/pull/42' }],
    });
  });

  it('STEP_NOT_HELD keeps the slot and explains', async () => {
    store().write(slot());
    const r = await runCli(cli, ['run', 'step', 'done'], bizError(2000, 'STEP_NOT_HELD: 该步骤不是分配给本 AI 员工的（emp:7）'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('✗ 回报步骤完成失败: 该步骤不是分配给本 AI 员工的（可能已被改派');
    expect(r.stderr).toContain('good7ob agent reset --keep-runner');
    expect(store().read()).toMatchObject({ status: 'busy', stepId: 45 });
  });

  it('another step than the slot\'s: the slot\'s org is still used when nothing else names one', async () => {
    store().write(slot());
    const r = await runCli(cli, ['run', 'step', 'done', '--run', '3', '--step', '46'], bizError(2000, 'STEP_NOT_HELD: 该步骤不是分配给本 AI 员工的（emp:5）'));
    expect(posts(r)).toEqual([['/api/v1/orgs/58/runs/3/steps/46/done', {}]]);
    expect(r.stderr).toContain('该步骤不是分配给本 AI 员工的');
    expect(store().read()).toMatchObject({ status: 'busy', stepId: 45 });
  });

  it('2718 (human key) and 2719 (closed) are explained', async () => {
    const human = await runCli(cli, ['run', 'step', 'done', '--run', '3', '--step', '45', '--org-id', '58'], bizError(2718, 'RUNNER_KEY_REQUIRED: 步骤回报只接受 AI 员工 Key'));
    expect(human.stderr).toContain('步骤回报只接受 AI 员工 Key：当前是人类账号的 Key');
    const closed = await runCli(cli, ['run', 'step', 'fail', '--run', '3', '--step', '45', '--org-id', '58', '--reason', 'x'], bizError(2719, 'STEP_CLOSED: 步骤已于 2026-10-29T10:00 结束超过 10 分钟'));
    expect(closed.stderr).toContain('步骤已结束超过 10 分钟，不再接受回报');
  });

  it('fail --reason text --retryable → AGENT_ERROR; frees the slot; shows the rework step', async () => {
    store().write(slot());
    const r = await runCli(cli, ['run', 'step', 'fail', '--reason', 'npm registry 超时', '--retryable'], ok({ stepId: 45, status: 'failed', retry: null, runStatus: 'failed' }));
    expect(posts(r)).toEqual([[`${STEP}/fail`, { reason: 'AGENT_ERROR', message: 'npm registry 超时' }]]);
    expect(r.stdout).toContain('已回报失败（failed），运行状态: failed，本地工作槽已空闲');
    store().write(slot({ nodeCode: 'TEST' }));
    const t = await runCli(cli, ['run', 'step', 'fail', '--reason', 'TEST_FAILED', '--message', '3 个用例失败'], ok({ status: 'failed', retry: { stepId: 50, nodeCode: 'DEV', attempt: 2 } }));
    expect(posts(t)[0][1]).toEqual({ reason: 'TEST_FAILED', message: '3 个用例失败' });
    expect(t.stdout).toContain('返工: DEV #50（第 2 次尝试）');
  });
});

describe('run tool-calls / files / artifacts', () => {
  it('tool-calls append maps the JSONL lines', async () => {
    store().write(slot());
    const file = path.join(tmpHome, 'calls.jsonl');
    fs.writeFileSync(file, '{"tool":"Bash","startedAt":"2026-10-29T10:00:00Z","durationMs":1200,"ok":true,"note":"npm test"}\n{"tool":"Edit","startedAt":"2026-10-29T10:00:02Z","durationMs":40,"ok":false}\n');
    const r = await runCli(cli, ['run', 'tool-calls', 'append', '--file', file], ok({ stored: 2 }));
    expect(posts(r)).toEqual([[`${STEP}/tool-calls`, { items: [
      { toolName: 'Bash', startedAt: '2026-10-29T10:00:00Z', durationMs: 1200, result: 'ok', summary: 'npm test' },
      { toolName: 'Edit', startedAt: '2026-10-29T10:00:02Z', durationMs: 40, result: 'error' },
    ] }]]);
    expect(r.stdout).toContain('已上传 2 条工具调用');
  });

  it('files report --from-git sends paths and counts only', async () => {
    store().write(slot());
    vi.spyOn(io, 'git').mockImplementation((args: string[]) => {
      if (args[1] === '--numstat') return '3\t1\tsrc/a.ts\0' + '1\t1\t\0src/old.ts\0src/new.ts\0';
      if (args[1] === '--name-status') return 'M\0src/a.ts\0R090\0src/old.ts\0src/new.ts\0';
      if (args[0] === 'merge-base') return 'aaaaaaaaaaaa\n';
      if (args[0] === 'rev-parse' && args[1] === '--short=12') return 'bbbbbbbbbbbb\n';
      return 'feat/y\n';
    });
    const r = await runCli(cli, ['run', 'files', 'report', '--from-git', 'main', '--pr', 'https://github.com/o/r/pull/7'], ok({ stored: 2, truncated: false }));
    expect(posts(r)).toEqual([[`${STEP}/files`, {
      files: [
        { path: 'src/a.ts', changeType: 'M', linesAdded: 3, linesDeleted: 1, prUrl: 'https://github.com/o/r/pull/7' },
        { path: 'src/new.ts', changeType: 'R', linesAdded: 1, linesDeleted: 1, oldPath: 'src/old.ts', prUrl: 'https://github.com/o/r/pull/7' },
      ],
      prUrl: 'https://github.com/o/r/pull/7',
      branch: 'feat/y',
      commitRange: 'aaaaaaaaaaaa..bbbbbbbbbbbb',
    }]]);
    expect(r.stdout).toContain('已上报 2 个文件（+4 −2）');
  });

  it('files report needs a source', async () => {
    store().write(slot());
    const r = await runCli(cli, ['run', 'files', 'report']);
    expect(r.stderr).toContain('需要 --from-git <base> 或 --files');
    expect(noHttpCalls(r)).toBe(true);
  });

  it('artifacts add: PR maps to PULL_REQUEST, 2727 explained', async () => {
    store().write(slot());
    const r = await runCli(cli, ['run', 'artifacts', 'add', '--type', 'PR', '--ref', 'https://github.com/o/r/pull/42', '--title', 'feat'], ok({ id: 5, objectType: 'PULL_REQUEST', objectId: 900 }));
    expect(posts(r)).toEqual([[`${STEP}/artifacts`, { type: 'PULL_REQUEST', url: 'https://github.com/o/r/pull/42', title: 'feat' }]]);
    expect(r.stdout).toContain('产物已关联: PULL_REQUEST #900（#5）');
    const bad = await runCli(cli, ['run', 'artifacts', 'add', '--type', 'TEST_RUN', '--ref', '7'], bizError(2727, 'ARTIFACT_TYPE_UNKNOWN: x'));
    expect(bad.stderr).toContain('产物类型不在闭集内');
  });
});

describe('run (human side)', () => {
  const detail = { id: 3, status: 'running', version: 4, automationName: 'nightly', automationId: 2, projectName: 'P', projectId: 5, steps: { total: 3, succeeded: 1, failed: 0, running: 1, waiting: 1 }, tokens: { total: 1500 }, cost: { amount: 0.12, currency: 'USD' }, permissions: { canPause: true, canHalt: true, canCancel: true }, stepList: [{ id: 45, groupNo: 1, nodeCode: 'DEV', attempt: 1, status: 'running', employeeName: 'Claude', runnerId: 12, taskId: 11, tokens: { total: 1500 }, logBytes: 2048 }] };

  it('list passes the filters', async () => {
    const r = await runCli(cli, ['run', 'list', '--org-id', '58', '--automation', '2', '--status', 'running'], ok({ items: [detail], total: 1 }));
    expect(r.http.get).toHaveBeenCalledWith('/api/v1/orgs/58/runs', expect.objectContaining({ params: { page: 1, pageSize: 20, automationId: 2, status: 'running' } }));
    expect(r.stdout).toContain('nightly #2');
    expect(r.stdout).toContain('1/0/1/1/3');
  });

  it('org falls back to the key\'s only organisation', async () => {
    const r = await runCli(cli, ['run', 'show', '3'], (m, url) => (url === '/api/v1/orgs' ? ok({ records: [{ id: 58, name: 'remo' }] }) : ok(detail)));
    expect(r.http.get).toHaveBeenCalledWith('/api/v1/orgs/58/runs/3', expect.anything());
    expect(r.stdout).toContain('运行 #3  running  version 4');
    expect(r.stdout).toContain('可执行操作: pause / halt / cancel');
    expect(r.stdout).toContain('Claude @R12');
  });

  it('pause reads the version first and sends it', async () => {
    const r = await runCli(cli, ['run', 'pause', '3', '--org-id', '58'], (m) => (m === 'get' ? ok(detail) : ok({ ...detail, status: 'running', pausingSub: true, version: 5 })));
    expect(r.http.get).toHaveBeenCalledWith('/api/v1/orgs/58/runs/3', expect.anything());
    expect(posts(r)).toEqual([['/api/v1/orgs/58/runs/3/pause', { version: 4 }]]);
    expect(r.stdout).toContain('✓ 运行 #3 已 pause（running → running，version 5）');
  });

  it('halt / cancel carry the reason; cancel without one is refused before any call', async () => {
    const h = await runCli(cli, ['run', 'halt', '3', '--org-id', '58', '--reason', '误触发'], (m) => (m === 'get' ? ok(detail) : ok({ status: 'paused', version: 5 })));
    expect(posts(h)).toEqual([['/api/v1/orgs/58/runs/3/halt', { version: 4, reason: '误触发' }]]);
    const c = await runCli(cli, ['run', 'cancel', '3', '--org-id', '58']);
    expect(c.stderr).toContain('run cancel 需要 --reason');
    expect(noHttpCalls(c)).toBe(true);
  });

  it('2723 and 2703 are explained', async () => {
    const conflict = await runCli(cli, ['run', 'resume', '3', '--org-id', '58'], (m) => (m === 'get' ? ok(detail) : bizError(2723, 'RUN_VERSION_CONFLICT: 运行已被他人更新（当前 version 5）')));
    expect(conflict.stderr).toContain('✗ run resume 失败: 运行已被他人更新（version 冲突）');
    const ai = await runCli(cli, ['run', 'pause', '3', '--org-id', '58'], (m) => (m === 'get' ? ok(detail) : bizError(2703, 'AUTOMATION_AI_FORBIDDEN: AI 员工不能执行此操作')));
    expect(ai.stderr).toContain('AI 员工 Key 不能操作运行');
  });

  it('step retry sends the version; reassign sends employee / reason', async () => {
    const r = await runCli(cli, ['run', 'step', 'retry', '3', '45', '--org-id', '58'], (m) => (m === 'get' ? ok(detail) : ok({ status: 'running', version: 5 })));
    expect(posts(r)).toEqual([['/api/v1/orgs/58/runs/3/steps/45/retry', { version: 4 }]]);
    const a = await runCli(cli, ['run', 'step', 'reassign', '3', '45', '--org-id', '58', '--employee', '8', '--reason', '换人'], ok({ status: 'waiting' }));
    expect(posts(a)).toEqual([['/api/v1/orgs/58/runs/3/steps/45/reassign', { employeeId: 8, reason: '换人' }]]);
  });

  it('logs prints the running step\'s tail; --follow polls /stream and fetches new segments until terminal', async () => {
    const sleeps: number[] = [];
    vi.spyOn(io, 'sleep').mockImplementation(async (ms: number) => void sleeps.push(ms));
    let streamCalls = 0;
    const r = await runCli(cli, ['run', 'logs', '3', '--org-id', '58', '--follow'], (m, url): Envelope => {
      if (url.endsWith('/steps')) return ok([{ id: 45, nodeCode: 'DEV', attempt: 1, status: 'running', logBytes: 10 }]);
      if (url.endsWith('/stream')) {
        streamCalls++;
        if (streamCalls === 1) return ok({ events: [{ id: 1, type: 'RUN_STARTED' }], steps: [{ stepId: 45, status: 'running', lastLogSeq: 2 }], next: 1, terminal: false, pollAfterSeconds: 10 });
        return ok({ events: [{ id: 2, type: 'STEP_FINISHED', fromStatus: 'running', toStatus: 'succeeded', message: '步骤 DEV 完成' }], steps: [{ stepId: 45, status: 'succeeded', lastLogSeq: 3 }, { stepId: 46, status: 'running', lastLogSeq: 1 }], next: 2, terminal: true, status: 'succeeded' });
      }
      if (url.endsWith('/steps/45/logs')) return ok(r45.shift());
      if (url.endsWith('/steps/46/logs')) return ok({ items: [{ seq: 1, content: 'test start\n' }], next: 1 });
      return ok(null);
    });
    expect(r.exitCode).toBeUndefined();
    expect(r.http.get).toHaveBeenCalledWith('/api/v1/orgs/58/runs/3/steps/45/logs', expect.objectContaining({ params: { limit: 20 } }));
    expect(r.http.get).toHaveBeenCalledWith('/api/v1/orgs/58/runs/3/stream', expect.objectContaining({ params: { since: 1 } }));
    expect(r.http.get).toHaveBeenCalledWith('/api/v1/orgs/58/runs/3/steps/45/logs', expect.objectContaining({ params: { after: 2, limit: 50 } }));
    expect(sleeps).toEqual([10_000]);
    expect(r.stdout.split('\n')).toEqual([
      '── 步骤 #45 DEV',
      'line 1',
      'line 2',
      '… 跟随运行 #3（每 10 秒轮询，Ctrl-C 退出）',
      expect.stringMatching(/STEP_FINISHED running→succeeded 步骤 DEV 完成$/),
      'line 3',
      '── 步骤 #46',
      'test start',
      '运行 #3 已结束（succeeded）',
    ]);
  });
  const r45: any[] = [];
  beforeEach(() => {
    r45.length = 0;
    r45.push({ items: [{ seq: 1, content: 'line 1\n' }, { seq: 2, content: 'line 2\n' }], next: 2 }, { items: [{ seq: 3, content: 'line 3\n' }], next: 3 });
  });
});

describe('agent done with a run step in the slot', () => {
  it('reports run step done instead of setting the task status, and frees the slot', async () => {
    store().write(slot());
    const r = await runCli(cli, ['agent', 'done', '11', '--summary', '完成', '--pr', 'https://github.com/o/r/pull/42'], ok({ stepId: 45, status: 'succeeded', taskStatus: 'awaiting_completion_approval' }));
    expect(r.exitCode).toBeUndefined();
    expect(r.http.put).not.toHaveBeenCalled();
    expect(posts(r)).toEqual([[`${STEP}/done`, { summary: '完成', prUrls: ['https://github.com/o/r/pull/42'] }]]);
    expect(r.stdout).toContain('步骤 #45 已回报完成（succeeded），任务状态: awaiting_completion_approval，本地工作槽已空闲');
    expect(store().read()).toEqual({ status: 'idle' });
  });

  it('--status given with a step slot: warned and not used', async () => {
    store().write(slot());
    const r = await runCli(cli, ['agent', 'done', '11', '--status', 'awaiting_completion_approval'], ok({ status: 'succeeded' }));
    expect(r.stderr).toContain('--status awaiting_completion_approval 未使用');
    expect(r.http.put).not.toHaveBeenCalled();
  });

  it('--no-step, a slot without a step, or another task keep the old task-status path', async () => {
    store().write(slot());
    const noStep = await runCli(cli, ['agent', 'done', '11', '--no-step'], ok({}));
    expect(noStep.http.put).toHaveBeenCalledWith('/progress/tasks/11', { status: 'completed' });
    expect(noStep.http.post).not.toHaveBeenCalled();

    store().write(slot({ stepId: null, runId: null }));
    const plain = await runCli(cli, ['agent', 'done', '11'], ok({}));
    expect(plain.http.put).toHaveBeenCalledWith('/progress/tasks/11', { status: 'completed' });

    store().write(slot());
    const other = await runCli(cli, ['agent', 'done', '12'], ok({}));
    expect(other.http.put).toHaveBeenCalledWith('/progress/tasks/12', { status: 'completed' });
    expect(other.http.post).not.toHaveBeenCalled();
  });

  it('step report failure keeps the slot and suggests --no-step / reset', async () => {
    store().write(slot());
    const r = await runCli(cli, ['agent', 'done', '11'], bizError(2719, 'STEP_CLOSED: 步骤已于 2026-10-29 10:00 结束超过 10 分钟'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('✗ 回报步骤完成失败: 步骤已结束超过 10 分钟');
    expect(r.stderr).toContain('--no-step');
    expect(store().read()).toMatchObject({ status: 'busy' });
  });
});

describe('log save ↔ run step', () => {
  const base = ['log', 'save', '--summary', 's', '--agent', 'claude', '--output', 'o'];

  it('attaches run / step / node / task from the slot', async () => {
    store().write(slot());
    const r = await runCli(cli, base, ok({ id: 1, runId: 3, stepId: 45 }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/ai-work-record', expect.objectContaining({ taskId: 11, runId: 3, stepId: 45, nodeCode: 'DEV' }));
    expect(r.stderr).toContain('已关联运行 #3 步骤 #45 节点 DEV（取自本地工作槽；--no-run-link 关闭）');
    expect(r.stdout).toContain('（运行 #3 步骤 #45）');
  });

  it('explicit flags win; another --task-id or --no-run-link attaches nothing', async () => {
    store().write(slot());
    const explicit = await runCli(cli, [...base, '--task-id', '20', '--run-id', '9', '--step-id', '90', '--node-code', 'TEST'], ok({ id: 2 }));
    expect(explicit.http.post).toHaveBeenCalledWith('/forge/ai-work-record', expect.objectContaining({ taskId: 20, runId: 9, stepId: 90, nodeCode: 'TEST' }));
    const other = await runCli(cli, [...base, '--task-id', '20'], ok({ id: 3 }));
    expect(other.http.post.mock.calls[0][1]).not.toHaveProperty('stepId');
    const off = await runCli(cli, [...base, '--no-run-link'], ok({ id: 4 }));
    expect(off.http.post.mock.calls[0][1]).not.toHaveProperty('stepId');
    expect(off.http.post.mock.calls[0][1]).not.toHaveProperty('taskId');
  });

  it('1001 (step not of this task) gets a hint', async () => {
    store().write(slot());
    const r = await runCli(cli, base, bizError(1001, '步骤 45 不属于任务 11'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('--step-id 必须属于 --task-id 的任务');
  });
});
