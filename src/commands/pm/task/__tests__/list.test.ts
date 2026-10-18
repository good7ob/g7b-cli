import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerTaskCommands } from '../index';
import { ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerTaskCommands(program.command('pm'));
const list = (args: string[]) => runCli(register, ['pm', 'task', 'list', '4', ...args], ok([]));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pm task list on_hold handling', () => {
  it('hides on_hold by default', async () => {
    const r = await list([]);
    expect(r.http.get).toHaveBeenCalledWith(
      '/progress/projects/4/tasks',
      { params: expect.objectContaining({ includeOnHold: false }) },
    );
  });

  it('--include-on-hold asks for them', async () => {
    const r = await list(['--include-on-hold']);
    expect(r.http.get).toHaveBeenCalledWith(
      '/progress/projects/4/tasks',
      { params: expect.objectContaining({ includeOnHold: true }) },
    );
  });

  it('--status on_hold implies including them', async () => {
    const r = await list(['--status', 'on_hold']);
    expect(r.http.get).toHaveBeenCalledWith(
      '/progress/projects/4/tasks',
      { params: expect.objectContaining({ status: 'on_hold', includeOnHold: true }) },
    );
  });
});
