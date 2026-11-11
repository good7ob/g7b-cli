/**
 * Bug 2119700418087194626: `infra --org-id 58 app list` must list org 58 even without GOOD7OB_ORG_ID.
 * Bug 2119700415948099586: `infra app create` must print the created snowflake id verbatim.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import apiClient from '../../../services/ApiClient';
import configService from '../../../services/ConfigService';
import { ok, runCli } from '../../../utils/__tests__/cliHarness';
import { registerInfraCommands } from '..';

const PAGE = { records: [], total: 0 };
const LIST_URL = '/api/infra/applications/list';

describe('infra app: org from the parent --org-id', () => {
  const env = process.env.GOOD7OB_ORG_ID;
  let configuredOrg: number | undefined;

  beforeEach(() => {
    delete process.env.GOOD7OB_ORG_ID;
    configuredOrg = undefined;
    const realGet = configService.get.bind(configService);
    vi.spyOn(configService, 'get').mockImplementation((key) => (key === 'orgId' ? configuredOrg : realGet(key)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (env === undefined) delete process.env.GOOD7OB_ORG_ID;
    else process.env.GOOD7OB_ORG_ID = env;
  });

  it('`infra --org-id 58 app list` lists org 58 with no env var or config', async () => {
    const r = await runCli(registerInfraCommands, ['infra', '--org-id', '58', 'app', 'list'], ok(PAGE));
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post).toHaveBeenCalledWith(LIST_URL, expect.objectContaining({ orgId: 58 }));
  });

  it('the parent --org-id beats a different configured org', async () => {
    configuredOrg = 7;
    const r = await runCli(registerInfraCommands, ['infra', '--org-id', '58', 'app', 'list', '--json'], ok(PAGE));
    expect(r.http.post).toHaveBeenCalledWith(LIST_URL, expect.objectContaining({ orgId: 58 }));
  });

  it('the subcommand --org-id still wins over the parent one', async () => {
    const r = await runCli(registerInfraCommands, ['infra', '--org-id', '58', 'app', 'list', '--org-id', '9'], ok(PAGE));
    expect(r.http.post).toHaveBeenCalledWith(LIST_URL, expect.objectContaining({ orgId: 9 }));
  });

  it('export and health-check take the parent --org-id too', async () => {
    const exp = await runCli(registerInfraCommands, ['infra', '--org-id', '58', 'app', 'export'], ok(PAGE));
    expect(exp.http.post).toHaveBeenCalledWith(LIST_URL, expect.objectContaining({ orgId: 58 }));
    const hc = await runCli(registerInfraCommands, ['infra', '--org-id', '58', 'app', 'health-check'], ok(PAGE));
    expect(hc.http.post).toHaveBeenCalledWith(LIST_URL, expect.objectContaining({ orgId: 58 }));
  });

  it('GOOD7OB_ORG_ID keeps working', async () => {
    process.env.GOOD7OB_ORG_ID = '12';
    const r = await runCli(registerInfraCommands, ['infra', 'app', 'list'], ok(PAGE));
    expect(r.http.post).toHaveBeenCalledWith(LIST_URL, expect.objectContaining({ orgId: 12 }));
  });
});

describe('infra app create: the new id is printed verbatim', () => {
  const http = apiClient['instance'];
  const adapter = http.defaults.adapter;

  afterEach(() => {
    http.defaults.adapter = adapter;
    vi.restoreAllMocks();
  });

  it('prints 2119699347172331521, not the rounded 2119699347172331500', async () => {
    // the backend answers Result.ok(app.getId()): a bare Long, i.e. a JSON number
    http.defaults.adapter = async (config) => ({
      data: '{"code":200,"msg":"操作成功","success":true,"data":2119699347172331521}',
      status: 200, statusText: 'OK', headers: {}, config, request: {},
    });
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')));
    const program = new Command().exitOverride();
    registerInfraCommands(program);
    await program.parseAsync(['node', 'good7ob', 'infra', '--org-id', '58', 'app', 'create', '-n', 'x', '-e', 'test', '-o', '263', '--created-by', '263']);
    expect(out.join('\n')).toContain('Application ID: 2119699347172331521');
  });
});
