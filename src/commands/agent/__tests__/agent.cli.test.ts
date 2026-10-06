import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerAgentCommands } from '../index';
import { bizError, ok, runCli } from '../../../utils/__tests__/cliHarness';
import { AgentStateStore } from '../state';

const home = process.env.HOME;
let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cli-'));
  process.env.HOME = tmpHome;
});
afterEach(() => {
  process.env.HOME = home;
  vi.restoreAllMocks();
});

describe('good7ob agent next', () => {
  it('skips a business-code 409 claim and exits 4 when nothing is left', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'next'], (m, url) =>
      m === 'get' ? ok([{ id: 1 }]) : bizError(409, '任务已被领取')
    );
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/1/claim', undefined);
    expect(r.exitCode).toBe(4);
    expect(new AgentStateStore(path.join(tmpHome, '.good7ob')).read()).toEqual({ status: 'idle' });
  });

  it('claims, then reports busy with exit 3 on the next call', async () => {
    const task = { id: 3, taskNo: 'T3', name: 'n', status: 'in_progress', estimatedHours: null };
    const first = await runCli(registerAgentCommands, ['agent', 'next', '--json'], (m) =>
      m === 'get' ? ok([{ id: 3 }]) : ok(task)
    );
    expect(first.exitCode).toBeUndefined();
    expect(JSON.parse(first.stdout).slot).toMatchObject({ status: 'busy', taskId: 3 });
    const second = await runCli(registerAgentCommands, ['agent', 'next'], ok(task));
    expect(second.exitCode).toBe(3);
  });
});

describe('good7ob agent done', () => {
  it('surfaces the backend state-machine error verbatim', async () => {
    const r = await runCli(registerAgentCommands, ['agent', 'done', '3'], bizError(400, '需先进入 awaiting_completion_approval'));
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/3', { status: 'completed' });
    expect(r.stderr).toContain('需先进入 awaiting_completion_approval');
    expect(r.exitCode).toBe(1);
  });
});
