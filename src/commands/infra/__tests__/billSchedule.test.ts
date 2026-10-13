/**
 * g7b #1645: `infra bill schedule` called /api/infra/bill-schedules, which does not exist
 * (BillController maps /api/infra/bills/schedules), so every schedule command answered 404.
 * The request bodies and the enable/disable/test branches must also match the backend contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import { registerBillCommands } from '../bill';

const BASE = '/api/infra/bills/schedules';

function run(...args: string[]) {
  const program = new Command().exitOverride();
  const infra = program.command('infra');
  registerBillCommands(infra);
  return program.parseAsync(['node', 'cli', 'infra', 'bill', 'schedule', ...args]);
}

describe('infra bill schedule', () => {
  let get: ReturnType<typeof vi.spyOn>;
  let post: ReturnType<typeof vi.spyOn>;
  let put: ReturnType<typeof vi.spyOn>;
  let patch: ReturnType<typeof vi.spyOn>;
  let del: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    get = vi.spyOn(apiClient, 'get').mockResolvedValue([]);
    post = vi.spyOn(apiClient, 'post').mockResolvedValue({ id: 1, nextRun: 'x', success: true });
    put = vi.spyOn(apiClient, 'put').mockResolvedValue({ id: 1, status: 'updated' });
    patch = vi.spyOn(apiClient, 'patch').mockResolvedValue(null);
    del = vi.spyOn(apiClient, 'delete').mockResolvedValue(null);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // the command exits the process on errors; turn that into a failure instead of killing vitest
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists schedules from /api/infra/bills/schedules', async () => {
    await run('--list-schedules');
    expect(get).toHaveBeenCalledWith(BASE);
  });

  it('creates a schedule with the field names the backend reads (provider, bucket, prefix)', async () => {
    await run('--add-schedule', '--provider', 'aws', '--bucket', 'b', '--prefix', 'p/');
    expect(post).toHaveBeenCalledWith(BASE, expect.objectContaining({ provider: 'aws', bucket: 'b', prefix: 'p/' }));
  });

  it('updates with bucketName / bucketPrefix and does not require --provider', async () => {
    await run('--schedule-id', '7', '--bucket', 'b2', '--prefix', 'q/');
    expect(put).toHaveBeenCalledWith(`${BASE}/7`, expect.objectContaining({ bucketName: 'b2', bucketPrefix: 'q/' }));
  });

  it('enables and disables with PATCH instead of falling into the update branch', async () => {
    await run('--schedule-id', '7', '--enabled');
    expect(patch).toHaveBeenCalledWith(`${BASE}/7/enable`, {});
    await run('--schedule-id', '7', '--disable');
    expect(patch).toHaveBeenCalledWith(`${BASE}/7/disable`, {});
    expect(put).not.toHaveBeenCalled();
  });

  it('tests a schedule with POST .../test', async () => {
    await run('--schedule-id', '7', '--test');
    expect(post).toHaveBeenCalledWith(`${BASE}/7/test`, {});
    expect(put).not.toHaveBeenCalled();
  });

  it('removes a schedule', async () => {
    await run('--remove-schedule', '7');
    expect(del).toHaveBeenCalledWith(`${BASE}/7`);
  });
});
