import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerQuestionCommands } from '../index';
import { bizError, noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

// the local agent slot: idle unless a test says otherwise (never read the real ~/.good7ob state file)
const slot = { state: { status: 'idle' } as Record<string, unknown> };
(globalThis as Record<string, unknown>).__questionTestSlot = slot;
vi.mock('../../agent/state', () => ({
  AgentStateStore: class {
    read() {
      return ((globalThis as Record<string, unknown>).__questionTestSlot as { state: unknown }).state;
    }
  },
}));

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

  describe('run link and AI confirmer (g7b #3344)', () => {
    const choice = [...base, '--type', 'choice', '--option', 'a=A', '--option', 'b=B'];
    afterEach(() => { slot.state = { status: 'idle' }; delete process.env.GOOD7OB_EMPLOYEE_ID; });

    it('links to the step the local agent holds by default', async () => {
      slot.state = { status: 'busy', taskId: 9, runId: 243, stepId: 135, orgId: 58 };
      const r = await question(choice);
      expect(r.http.post.mock.calls[0][1]).toMatchObject({ runId: 243, stepId: 135 });
      expect(r.stdout).toContain('运行 #243 步骤 #135');
    });

    it('sends --run-id / --step-id as given, and --no-run-link sends none', async () => {
      slot.state = { status: 'busy', taskId: 9, runId: 243, stepId: 135 };
      let r = await question([...choice, '--step-id', '7']);
      expect(r.http.post.mock.calls[0][1]).toMatchObject({ stepId: 7 });
      expect(r.http.post.mock.calls[0][1]).not.toHaveProperty('runId');
      r = await question([...choice, '--no-run-link']);
      expect(r.http.post.mock.calls[0][1]).not.toHaveProperty('runId');
      expect(r.http.post.mock.calls[0][1]).not.toHaveProperty('stepId');
      await expectRejected([...choice, '--no-run-link', '--run-id', '1'], '--no-run-link');
    });

    it('an idle slot links nothing', async () => {
      const r = await question(choice);
      expect(r.http.post.mock.calls[0][1]).not.toHaveProperty('runId');
    });

    it('--assignee-employee takes an id or self (GOOD7OB_EMPLOYEE_ID), plus --decision-key', async () => {
      let r = await question([...choice, '--assignee-employee', '40', '--decision-key', 'first-node-rule']);
      expect(r.http.post.mock.calls[0][1]).toMatchObject({ assigneeEmployeeId: 40, decisionKey: 'first-node-rule' });
      process.env.GOOD7OB_EMPLOYEE_ID = '40';
      r = await question([...choice, '--assignee-employee', 'self']);
      expect(r.http.post.mock.calls[0][1]).toMatchObject({ assigneeEmployeeId: 40 });
      delete process.env.GOOD7OB_EMPLOYEE_ID;
      await expectRejected([...choice, '--assignee-employee', 'self'], 'GOOD7OB_EMPLOYEE_ID');
      await expectRejected([...choice, '--decision-key', 'x'.repeat(121)], '--decision-key');
    });
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

  it('--update PUTs the new answer instead of POSTing (g7b #2348)', async () => {
    const r = await question(['answer', '7', '--option', 'b', '--update'], ok({ id: 7, status: 'answered', answerOptionKey: 'b' }));
    expect(r.exitCode).toBeUndefined();
    expect(r.http.put).toHaveBeenCalledWith('/forge/questions/7/answer', { answerOptionKey: 'b' });
    expect(r.http.post).not.toHaveBeenCalled();
    expect(r.stdout).toContain('已修改');
  });

  it('--update still needs an answer and maps 1007 (approval questions)', async () => {
    await expectRejected(['answer', '7', '--update'], '至少给一个');
    const r = await question(['answer', '7', '--text', 'x', '--update'], bizError(1007, '需要审批的问题暂不支持修改回答'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('修改回答失败');
  });
});
