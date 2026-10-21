import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerTaskCommands } from '../index';
import { noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerTaskCommands(program.command('pm'));
const update = (id: string, args: string[], response = ok(null)) =>
  runCli(register, ['pm', 'task', 'update', id, ...args], response);

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(['create', 'update'])('pm task %s planned dates', (command) => {
  const run = (args: string[]) => runCli(register, [
    'pm', 'task', command,
    ...(command === 'create' ? ['--project-id', '4', '--name', 'Scheduled task'] : ['5']),
    ...args,
  ], ok({ id: 5 }));

  it('sends planned start and end independently of the deadline', async () => {
    const r = await run(['--planned-start-date', '2026-10-20', '--planned-end-date', '2026-10-25', '--deadline', '2026-10-30']);
    const http = command === 'create' ? r.http.post : r.http.put;
    expect(http).toHaveBeenCalledWith(command === 'create' ? '/progress/tasks' : '/progress/tasks/5', expect.objectContaining({
      plannedStartDate: '2026-10-20', plannedEndDate: '2026-10-25', deadline: '2026-10-30',
    }));
    expect(r.exitCode).toBeUndefined();
  });

  it('allows updating only the planned end', async () => {
    const r = await run(['--planned-end-date', '2026-10-25']);
    const http = command === 'create' ? r.http.post : r.http.put;
    const body = http.mock.calls[0][1];
    expect(body.plannedEndDate).toBe('2026-10-25');
    expect(body).not.toHaveProperty('plannedStartDate');
    expect(body).not.toHaveProperty('deadline');
  });

  it.each(['2026-02-30', '2026-13-01', 'tomorrow', '2026-10-25T12:00:00'])('rejects invalid dates: %s', async (date) => {
    const r = await run(['--planned-end-date', date]);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
    expect(r.stderr).toContain('--planned-end-date');
  });

  it('rejects a planned end before the planned start', async () => {
    const r = await run(['--planned-start-date', '2026-10-25', '--planned-end-date', '2026-10-20']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });

  it('allows a one-day task', async () => {
    const r = await run(['--planned-start-date', '2026-10-25', '--planned-end-date', '2026-10-25']);
    expect(r.exitCode).toBeUndefined();
  });
});

describe('pm task update --estimated-hours', () => {
  it('sends estimatedHours as a number in the PUT body', async () => {
    const r = await update('5', ['--estimated-hours', '8.5']);
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/5', { estimatedHours: 8.5 });
    expect(r.exitCode).toBeUndefined();
  });

  it('combines with other update fields', async () => {
    const r = await update('7', ['--priority', 'high', '--estimated-hours', '3']);
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/7', { priority: 'high', estimatedHours: 3 });
  });
});
