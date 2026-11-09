import { describe, expect, it } from 'vitest';
import * as os from 'os';
import {
  describeAssignment,
  heartbeatPayload,
  isAssignedItem,
  isAssignedToOther,
  isFatalAuth,
  isJobMismatch,
  normalizeAgentKind,
  normalizeHostId,
  offlinePath,
  parseEnvTags,
  parseSlots,
  registerPayload,
  resolveRunnerOptions,
  stopStepIdsOf,
  toRegistration,
} from '../runner';

describe('argument parsing', () => {
  it('slots: integer 1..8', () => {
    expect(parseSlots('1')).toBe(1);
    expect(parseSlots('8')).toBe(8);
    expect(() => parseSlots('0')).toThrow(/1 到 8/);
    expect(() => parseSlots('9')).toThrow(/1 到 8/);
    expect(() => parseSlots('two')).toThrow(/整数/);
  });

  it('env: comma list, lower-cased, de-duplicated, subset of dev/test/prod', () => {
    expect(parseEnvTags('dev, Test,dev')).toEqual(['dev', 'test']);
    expect(parseEnvTags('')).toEqual([]);
    expect(parseEnvTags(undefined)).toEqual([]);
    expect(() => parseEnvTags('dev,staging')).toThrow(/staging/);
  });

  it('agent kind: upper-cased code', () => {
    expect(normalizeAgentKind('claude_code')).toBe('CLAUDE_CODE');
    expect(() => normalizeAgentKind('claude code')).toThrow(/代码/);
  });

  it('host id: defaults to the hostname, rejects whitespace', () => {
    expect(normalizeHostId(undefined)).toBe(os.hostname());
    expect(normalizeHostId(' box-1 ')).toBe('box-1');
    expect(() => normalizeHostId('a b')).toThrow(/非空白/);
  });

  it('flags win over config, config over defaults', () => {
    const o = resolveRunnerOptions({}, {}, '/tmp/good7ob');
    expect(o).toMatchObject({ slots: 1, envTags: [], agentKind: 'CLAUDE_CODE', hostId: os.hostname(), hostLabel: `${os.hostname()}:good7ob` });
    expect(resolveRunnerOptions({}, { slots: 3, envTags: ['prod'], agentKind: 'CODEX', hostId: 'cfg-host' })).toMatchObject({
      slots: 3,
      envTags: ['prod'],
      agentKind: 'CODEX',
      hostId: 'cfg-host',
    });
    expect(resolveRunnerOptions({ slots: '2', env: 'dev,test', agentKind: 'custom', hostId: 'flag-host' }, { slots: 3, hostId: 'cfg-host' })).toMatchObject({
      slots: 2,
      envTags: ['dev', 'test'],
      agentKind: 'CUSTOM',
      hostId: 'flag-host',
    });
  });
});

describe('payloads', () => {
  const opts = resolveRunnerOptions({ slots: '2', env: 'dev', hostId: 'mbp' }, {}, '/w/good7ob');

  it('register: backend RegisterRunnerDto field names', () => {
    expect(registerPayload(opts)).toEqual({
      runnerKey: 'mbp',
      hostLabel: `${os.hostname()}:good7ob`,
      agentKind: 'CLAUDE_CODE',
      slots: 2,
      envTags: ['dev'],
    });
  });

  it('heartbeat: nothing without a runner, id + key + only the given attributes with one', () => {
    expect(heartbeatPayload()).toBeUndefined();
    expect(heartbeatPayload({ slots: 2 })).toBeUndefined();
    expect(heartbeatPayload({ runnerId: 12, runnerKey: 'mbp' })).toEqual({ runnerId: 12, runnerKey: 'mbp' });
    expect(heartbeatPayload({ runnerId: 12, slots: 2, envTags: [] })).toEqual({ runnerId: 12, slots: 2, envTags: [] });
  });

  it('offline: runner identity as query parameters', () => {
    expect(offlinePath()).toBe('/api/v1/me/heartbeat');
    expect(offlinePath({ runnerId: 12, runnerKey: 'mbp' })).toBe('/api/v1/me/heartbeat?runnerKey=mbp&runnerId=12');
  });

  it('stopStepIds: numeric list or nothing', () => {
    expect(stopStepIdsOf(undefined)).toEqual([]);
    expect(stopStepIdsOf({})).toEqual([]);
    expect(stopStepIdsOf({ stopStepIds: [345, '7', 'x'] })).toEqual([345, 7]);
  });

  it('registration: RunnerVo `id` or design-doc `runnerId`, backend values win over the request', () => {
    const t0 = Date.parse('2026-10-29T00:00:00Z');
    expect(toRegistration({ id: 12, hostKey: 'mbp', slots: 2, envTags: ['dev'], agentKind: 'CLAUDE_CODE' }, opts, t0)).toEqual({
      runnerId: 12,
      runnerKey: 'mbp',
      hostLabel: `${os.hostname()}:good7ob`,
      slots: 2,
      envTags: ['dev'],
      agentKind: 'CLAUDE_CODE',
      registeredAt: '2026-10-29T00:00:00.000Z',
    });
    expect(toRegistration({ runnerId: 5 }, opts, t0)).toMatchObject({ runnerId: 5, runnerKey: 'mbp', slots: 2, envTags: ['dev'] });
    expect(() => toRegistration({}, opts, t0)).toThrow(/runnerId/);
  });
});

describe('error classification', () => {
  const err = (props: Record<string, unknown>, message = 'boom') => Object.assign(new Error(message), props);

  it('fatal auth: 401/403/404, 2718, or the "AI employee key only" refusal', () => {
    expect(isFatalAuth(err({ status: 401 }))).toBe(true);
    expect(isFatalAuth(err({ code: 403 }, '仅 AI 员工 Key 可注册 Runner'))).toBe(true);
    expect(isFatalAuth(err({ code: 2718 }))).toBe(true);
    expect(isFatalAuth(err({ status: 503 }))).toBe(false);
    expect(isFatalAuth(new Error('Network Error'))).toBe(false);
  });

  it('assigned to other: backend ASSIGNED_TO_OTHER prefix or design code 2716', () => {
    expect(isAssignedToOther(err({ code: 409 }, 'ASSIGNED_TO_OTHER: 任务 7 已分配给同一员工的另一台 Runner #3'))).toBe(true);
    expect(isAssignedToOther(err({ code: 2716 }))).toBe(true);
    expect(isAssignedToOther(err({ code: 409 }, '任务已被领取'))).toBe(false);
    expect(isJobMismatch(err({ code: 400 }, 'JOB_MISMATCH: AI 员工 emp:9 的岗位不含 测试'))).toBe(true);
  });
});

describe('assigned items', () => {
  it('detects the assignment via assignmentId / assigned / isAssigned', () => {
    expect(isAssignedItem({ id: 1 })).toBe(false);
    expect(isAssignedItem({ id: 1, assignmentId: 9 })).toBe(true);
    expect(isAssignedItem({ id: 1, assigned: true })).toBe(true);
    expect(isAssignedItem({ id: 1, isAssigned: true })).toBe(true);
  });

  it('renders run / step / node and the node brief, nothing for a free-pool task', () => {
    expect(describeAssignment({ id: 1 })).toBe('');
    const text = describeAssignment({
      id: 1,
      assignmentId: 9,
      runId: 3,
      stepId: 45,
      nodeCode: 'DEV',
      requiredJob: 'DEV',
      leaseUntil: Date.parse('2026-10-29T01:00:00Z'),
      nodePrompt: '按任务描述实现并提交 PR',
      nodeExpectedOutput: 'PR 链接',
      nodeExitChecklist: ['单测通过', 'PR 已创建'],
    });
    expect(text).toContain('分配 #9  运行 #3  步骤 #45  节点 DEV（岗位 DEV）  租约至 2026-10-29T01:00:00.000Z');
    expect(text).toContain('节点提示: 按任务描述实现并提交 PR');
    expect(text).toContain('期望产出: PR 链接');
    expect(text).toContain('完成清单: 单测通过；PR 已创建');
  });
});
