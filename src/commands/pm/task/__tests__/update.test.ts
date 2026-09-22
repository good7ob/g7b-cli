import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerTaskCommands } from '../index';
import { ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerTaskCommands(program.command('pm'));
const update = (id: string, args: string[], response = ok(null)) =>
  runCli(register, ['pm', 'task', 'update', id, ...args], response);

afterEach(() => {
  vi.restoreAllMocks();
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
