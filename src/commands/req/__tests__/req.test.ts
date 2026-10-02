import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerReqCommands } from '../index';
import { noHttpCalls, ok, runCli } from '../../../utils/__tests__/cliHarness';

const req = (args: string[]) => runCli(registerReqCommands, ['req', ...args], ok({ id: 12, title: '想要个导出功能' }));

beforeEach(() => {
  process.env.GOOD7OB_PRODUCT_ID = '9';
});
afterEach(() => {
  delete process.env.GOOD7OB_PRODUCT_ID;
  vi.restoreAllMocks();
});

describe('req add (alias of idea create)', () => {
  it('creates an idea from an unquoted title with source pm and the configured product', async () => {
    const r = await req(['add', '想要个导出功能']);
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas', { productId: 9, title: '想要个导出功能', source: 'pm' });
    expect(r.stdout).toContain('#12');
    expect(r.exitCode).toBeUndefined();
  });

  it('joins variadic words and passes optional idea fields through', async () => {
    const r = await req(['add', 'export', 'csv', '--product', '3', '-s', 'customer', '--priority', 'high']);
    expect(r.http.post).toHaveBeenCalledWith('/forge/ideas', { productId: 3, title: 'export csv', source: 'customer', priority: 'high' });
  });

  it('points retired subcommands at good7ob idea and exits non-zero', async () => {
    const r = await req(['ls']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('good7ob idea');
    expect(noHttpCalls(r)).toBe(true);
  });
});
