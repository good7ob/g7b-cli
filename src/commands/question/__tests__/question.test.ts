import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerQuestionCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const Q = {
  id: 7, title: '用哪个方案?', questionType: 'choice', status: 'open', source: 'dev', needsApproval: false,
  options: [{ key: 'a', label: '方案A' }, { key: 'b', label: '方案B', description: '更快' }],
  assigneeId: 3, taskId: 9, createdAt: '2026-10-08 10:00:00',
};
const question = (args: string[], response = ok(Q)) => runCli(registerQuestionCommands, ['question', ...args], response);
afterEach(() => vi.restoreAllMocks());

async function expectRejected(args: string[], needle: string) {
  const r = await question(args);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain(needle);
  expect(noHttpCalls(r)).toBe(true);
}

describe('question create', () => {
  const base = ['create', '--title', '用哪个方案?', '--source', 'dev'];

  it('POSTs a choice question with parsed options', async () => {
    const r = await question([...base, '--type', 'choice', '--option', 'a=方案A', '--option', 'b=方案B|更快', '--task', '9', '--needs-approval']);
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post).toHaveBeenCalledWith('/forge/questions', {
      title: '用哪个方案?', questionType: 'choice', source: 'dev', taskId: 9, needsApproval: true,
      options: [{ key: 'a', label: '方案A' }, { key: 'b', label: '方案B', description: '更快' }],
    });
    expect(r.stdout).toContain('#7');
  });

  it('POSTs a text question without options', async () => {
    const r = await question([...base, '--type', 'text']);
    expect(r.http.post.mock.calls[0][1]).not.toHaveProperty('options');
  });

  it('rejects choice with <2 options, text with options, duplicate keys, bad enums', async () => {
    await expectRejected([...base, '--type', 'choice', '--option', 'a=A'], '至少需要 2');
    await expectRejected([...base, '--type', 'text', '--option', 'a=A'], '不能带');
    await expectRejected([...base, '--type', 'choice', '--option', 'a=A', '--option', 'a=B'], '不能重复');
    await expectRejected([...base, '--type', 'nope'], '--type');
    await expectRejected(['create', '--title', 'x', '--type', 'text', '--source', 'zzz'], '--source');
  });

  it('maps business errors', async () => {
    const r = await question([...base, '--type', 'text'], bizError(1001, '任务不存在: 9'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('创建 Question 失败');
  });
});

describe('question list / get', () => {
  it('passes filters and renders the page', async () => {
    const r = await question(['list', '--assignee', '3', '--status', 'open'], ok({ total: 1, page: 1, pageSize: 20, items: [Q] }));
    expect(r.http.get).toHaveBeenCalledWith('/forge/questions', { params: { page: 1, pageSize: 20, assigneeId: 3, status: 'open' } });
    expect(r.stdout).toContain('共 1 条');
  });

  it('says so when empty and rejects a bad status', async () => {
    const r = await question(['list'], ok({ total: 0, items: [] }));
    expect(r.stdout).toContain('没有符合条件');
    await expectRejected(['list', '--status', 'bogus'], '--status');
  });

  it('shows detail with options', async () => {
    const r = await question(['get', '7']);
    expect(r.http.get).toHaveBeenCalledWith('/forge/questions/7', { params: undefined });
    expect(r.stdout).toContain('b: 方案B（更快）');
  });
});

describe('question answer', () => {
  it('POSTs the option key', async () => {
    const r = await question(['answer', '7', '--option', 'a', '--text', '理由'], ok({ id: 7, status: 'answered', taskResumed: true }));
    expect(r.http.post).toHaveBeenCalledWith('/forge/questions/7/answer', { answerOptionKey: 'a', answerText: '理由' });
    expect(r.stdout).toContain('PENDING_INFO');
  });

  it('shows the approval when it moves to pending_approval', async () => {
    const r = await question(['answer', '7', '--option', 'a'], ok({ id: 7, status: 'pending_approval', approvalId: 55 }));
    expect(r.stdout).toContain('审批单 #55');
  });

  it('needs an option or text, and a valid id', async () => {
    await expectRejected(['answer', '7'], '至少给一个');
    await expectRejected(['answer', 'x', '--text', 'hi'], 'id');
  });
});
