import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerTaskCommands } from '../index';
import { isDisplayNoRef, pickScope } from '../ref';
import { bizError, noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

/**
 * g7b #3274 (api-0190 §7.1): `pm task get / update / delete <ref>` — a ref like 1600-3 is turned into the internal
 * id through GET /progress/tasks/by-no first; a bare number is still the internal id and never touches by-no.
 */

const register = (program: Command) => registerTaskCommands(program.command('pm'));
const task = { id: 3301, name: '子任务甲', projectId: 4, status: 'not_started', displayNo: '1600-3', displayNoKind: 'SUB_NO' };

/** by-no answers the task; every other GET (and the writes) answer ok. */
const answer = (data: unknown = task) => (method: string, url: string) =>
  ok(url === '/progress/tasks/by-no' ? data : method === 'get' ? task : { id: 3301 });

const run = (args: string[], response = answer()) => runCli(register, ['pm', 'task', ...args], response);
const getCalls = (r: Awaited<ReturnType<typeof run>>) => r.http.get.mock.calls.map((c) => c[0]);

beforeEach(() => {
  delete process.env.GOOD7OB_PROJECT_ID;
  delete process.env.GOOD7OB_ORG_ID;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('isDisplayNoRef', () => {
  it.each(['1600-3', '#1600-3', '1-1', '#12-34'])('%s is a display number', (ref) => {
    expect(isDisplayNoRef(ref)).toBe(true);
  });
  it.each(['1600', '#1600', '3268', '16-', '-3', '1600-3-2', '1600-a', ' 1600-3', ''])('%s is not', (ref) => {
    expect(isDisplayNoRef(ref)).toBe(false);
  });
});

describe('pickScope', () => {
  it('uses an explicit --org', () => {
    expect(pickScope({ org: '7' }, {}, {})).toEqual({ orgId: 7 });
  });
  it('uses an explicit --project', () => {
    expect(pickScope({ project: '4' }, {}, {})).toEqual({ projectId: 4 });
  });
  it('refuses --org together with --project', () => {
    expect(() => pickScope({ org: '7', project: '4' }, {}, {})).toThrow('只能二选一');
  });
  it('without flags falls back to the current project (env, then config), then the org', () => {
    expect(pickScope({}, { projectId: 9, orgId: 2 }, { GOOD7OB_PROJECT_ID: '5' })).toEqual({ projectId: 5 });
    expect(pickScope({}, { projectId: 9, orgId: 2 }, {})).toEqual({ projectId: 9 });
    expect(pickScope({}, { orgId: 2 }, {})).toEqual({ orgId: 2 });
    expect(pickScope({}, {}, { GOOD7OB_ORG_ID: '3' })).toEqual({ orgId: 3 });
  });
  it('an explicit flag beats the remembered project', () => {
    expect(pickScope({ org: '7' }, { projectId: 9 }, { GOOD7OB_PROJECT_ID: '5' })).toEqual({ orgId: 7 });
  });
  it('fails with a hint when nothing says which org or project', () => {
    expect(() => pickScope({}, {}, {})).toThrow(/--org.*--project/);
  });
  it('rejects a non-numeric flag', () => {
    expect(() => pickScope({ project: 'abc' }, {}, {})).toThrow('--project');
  });
});

describe('pm task get <ref>', () => {
  it('turns 1600-3 into the task through by-no with the project, in one call', async () => {
    const r = await run(['get', '1600-3', '--project', '4']);
    expect(r.http.get).toHaveBeenCalledTimes(1);
    expect(r.http.get).toHaveBeenCalledWith('/progress/tasks/by-no', { params: { no: '1600-3', projectId: 4 } });
    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).toContain('子任务甲');
  });

  it('accepts #1600-3 and --org, sending the number without the #', async () => {
    const r = await run(['get', '#1600-3', '--org', '7']);
    expect(r.http.get.mock.calls[0][1]).toEqual({ params: { no: '1600-3', orgId: 7 } });
  });

  it('prints the display number next to the internal id', async () => {
    const r = await run(['get', '1600-3', '--project', '4']);
    expect(r.stdout).toMatch(/ID:\s+3301/);
    expect(r.stdout).toMatch(/任务号:\s+1600-3（SUB_NO）/);
  });

  it('--json stays the plain task', async () => {
    const r = await run(['get', '1600-3', '--project', '4', '--json']);
    expect(JSON.parse(r.stdout).id).toBe(3301);
  });

  it('uses the remembered project from the environment when no flag is given', async () => {
    process.env.GOOD7OB_PROJECT_ID = '4';
    const r = await run(['get', '1600-3']);
    expect(r.http.get.mock.calls[0][1]).toEqual({ params: { no: '1600-3', projectId: 4 } });
  });

  it('a bare number is still the internal id: no by-no, same URL as before', async () => {
    const r = await run(['get', '3301']);
    expect(getCalls(r)).toEqual(['/progress/tasks/3301']);
    expect(r.stdout).toMatch(/任务号:\s+1600-3（SUB_NO）/);
  });

  it('a task without displayNo (older server) prints no 任务号 line', async () => {
    const r = await run(['get', '3301'], () => ok({ id: 3301, name: 'x', projectId: 4 }));
    expect(r.stdout).not.toContain('任务号');
  });

  it('a bare number ignores --org / --project', async () => {
    const r = await run(['get', '3301', '--project', '4']);
    expect(getCalls(r)).toEqual(['/progress/tasks/3301']);
  });

  it('no org or project known: stops before any request', async () => {
    const r = await run(['get', '1600-3']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
    expect(r.stderr).toContain('--project');
  });

  it('a task that is not found (or not readable) fails the command', async () => {
    const r = await run(['get', '1600-9', '--project', '4'], () => bizError(500, '任务不存在或无权访问'));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('任务不存在或无权访问');
  });
});

describe('pm task update <ref>', () => {
  it('resolves first, tells which task it is, then writes to the internal id', async () => {
    const r = await run(['update', '1600-3', '--project', '4', '--status', 'completed']);
    expect(getCalls(r)).toEqual(['/progress/tasks/by-no']);
    expect(r.http.put).toHaveBeenCalledTimes(1);
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/3301', { status: 'completed' });
    expect(r.stderr).toContain('1600-3');
    expect(r.stderr).toContain('子任务甲');
    expect(r.stderr).toMatch(/项目\s*4/);
  });

  it('prints the line before the write happens', async () => {
    const order: string[] = [];
    const r = await run(['update', '1600-3', '--project', '4', '--name', 'n'], (m, url) => {
      order.push(`${m} ${url}`);
      return answer()(m, url);
    });
    expect(order).toEqual(['get /progress/tasks/by-no', 'put /progress/tasks/3301']);
    expect(r.exitCode).toBeUndefined();
  });

  it('keeps --project-id as the move target; --project only scopes the lookup', async () => {
    const r = await run(['update', '1600-3', '--project', '4', '--project-id', '9']);
    expect(r.http.get.mock.calls[0][1]).toEqual({ params: { no: '1600-3', projectId: 4 } });
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/3301', { projectId: 9 });
  });

  it('--json output stays pure JSON on stdout', async () => {
    const r = await run(['update', '1600-3', '--project', '4', '--status', 'completed', '--json']);
    expect(JSON.parse(r.stdout)).toEqual({ id: 3301 });
  });

  it('does not write when the lookup fails', async () => {
    const r = await run(['update', '1600-9', '--project', '4', '--status', 'completed'], () => bizError(500, '任务不存在或无权访问'));
    expect(r.exitCode).toBe(1);
    expect(r.http.put).not.toHaveBeenCalled();
  });

  it('a bare number writes straight to that id, no by-no and no extra GET', async () => {
    const r = await run(['update', '3301', '--status', 'completed']);
    expect(r.http.get).not.toHaveBeenCalled();
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/3301', { status: 'completed' });
  });

  it('a bare number ignores --project (it is only a lookup scope)', async () => {
    const r = await run(['update', '3301', '--project', '4', '--status', 'completed']);
    expect(r.http.get).not.toHaveBeenCalled();
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/3301', { status: 'completed' });
  });
});

describe('pm task delete <ref>', () => {
  it('resolves, then deletes the internal id with -f', async () => {
    const r = await run(['delete', '1600-3', '--project', '4', '-f']);
    expect(getCalls(r)).toEqual(['/progress/tasks/by-no']);
    expect(r.http.delete).toHaveBeenCalledWith('/progress/tasks/3301', undefined);
    expect(r.stderr).toContain('子任务甲');
  });

  it('without -f only shows which task would go, deletes nothing', async () => {
    const r = await run(['delete', '1600-3', '--project', '4']);
    expect(r.http.delete).not.toHaveBeenCalled();
    expect(r.stdout + r.stderr).toContain('子任务甲');
    expect(r.stdout).toContain('3301');
  });

  it('does not delete when the lookup fails', async () => {
    const r = await run(['delete', '1600-9', '--project', '4', '-f'], () => bizError(500, '任务不存在或无权访问'));
    expect(r.exitCode).toBe(1);
    expect(r.http.delete).not.toHaveBeenCalled();
  });

  it('a bare number deletes that id as before', async () => {
    const r = await run(['delete', '3301', '-f']);
    expect(r.http.get).not.toHaveBeenCalled();
    expect(r.http.delete).toHaveBeenCalledWith('/progress/tasks/3301', undefined);
  });
});
