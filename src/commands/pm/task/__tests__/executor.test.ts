import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { executorFields, registerTaskCommands } from '../index';
import { noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerTaskCommands(program.command('pm'));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('executorFields', () => {
  it('sends nothing when no executor flag is given', () => expect(executorFields({})).toEqual({}));
  it('maps --ai-employee to AGENT + emp:<id>', () =>
    expect(executorFields({ aiEmployee: '5' })).toEqual({ executorType: 'AGENT', executorId: 'emp:5' }));
  it('normalises a bare AGENT id to emp:<id>', () =>
    expect(executorFields({ executorType: 'agent', executorId: '5' })).toEqual({ executorType: 'AGENT', executorId: 'emp:5' }));
  it('keeps an explicit emp:<id>', () =>
    expect(executorFields({ executorType: 'AGENT', executorId: 'emp:12' })).toEqual({ executorType: 'AGENT', executorId: 'emp:12' }));
  it('passes other agent ids through', () =>
    expect(executorFields({ executorType: 'AGENT', executorId: 'hermes-v1' })).toEqual({ executorType: 'AGENT', executorId: 'hermes-v1' }));
  it('sends a HUMAN executor as a user id string', () =>
    expect(executorFields({ executorType: 'HUMAN', executorId: '263' })).toEqual({ executorType: 'HUMAN', executorId: '263' }));
  it('allows the type alone', () => expect(executorFields({ executorType: 'HUMAN' })).toEqual({ executorType: 'HUMAN' }));
  it('rejects an unknown type', () => expect(() => executorFields({ executorType: 'ROBOT' })).toThrow('--executor-type'));
  it('rejects --executor-id without a type', () => expect(() => executorFields({ executorId: '5' })).toThrow('--executor-type'));
  it('rejects --ai-employee combined with --executor-type', () =>
    expect(() => executorFields({ aiEmployee: '5', executorType: 'AGENT' })).toThrow('--ai-employee'));
  it.each(['0', '-1', 'abc', 'emp:5'])('rejects --ai-employee %s', (raw) =>
    expect(() => executorFields({ aiEmployee: raw })).toThrow('--ai-employee'));
  it('rejects a non-numeric HUMAN id', () =>
    expect(() => executorFields({ executorType: 'HUMAN', executorId: 'emp:5' })).toThrow('--executor-id'));
});

describe.each(['create', 'update'])('pm task %s executor flags', (command) => {
  const run = (args: string[]) => runCli(register, [
    'pm', 'task', command,
    ...(command === 'create' ? ['--project-id', '4', '--name', 'Fix it'] : ['5']),
    ...args,
  ], ok({ id: 5 }));
  const body = (r: Awaited<ReturnType<typeof run>>) =>
    (command === 'create' ? r.http.post : r.http.put).mock.calls[0][1];

  it('hands the task to an AI employee', async () => {
    const r = await run(['--ai-employee', '5']);
    expect(r.exitCode).toBeUndefined();
    expect(body(r)).toEqual(expect.objectContaining({ executorType: 'AGENT', executorId: 'emp:5' }));
  });

  it('leaves the executor untouched when no flag is given', async () => {
    const r = await run(['--priority', 'high']);
    expect(body(r)).not.toHaveProperty('executorType');
    expect(body(r)).not.toHaveProperty('executorId');
  });

  it('refuses invalid input without calling the API', async () => {
    const r = await run(['--executor-type', 'ROBOT']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
    expect(r.stderr).toContain('--executor-type');
  });
});

describe('pm task get', () => {
  it('shows the executor id', async () => {
    const r = await runCli(register, ['pm', 'task', 'get', '5'],
      ok({ id: 5, name: 'Fix it', status: 'in_progress', projectId: 4, executorType: 'AGENT', executorId: 'emp:5' }));
    expect(r.stdout).toContain('emp:5');
  });
});
