/**
 * backend#564: /api/infra/** is isolated per organization and requires X-Org-Id. Every `infra`
 * subcommand resolves the org once (--org-id, GOOD7OB_ORG_ID, `config set org-id`) before it runs,
 * and the API client sends it on infra calls only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import apiClient, { withInfraOrg } from '../../../services/ApiClient';
import { registerInfraCommands } from '..';

describe('withInfraOrg', () => {
  it('adds X-Org-Id to an /api/infra request', () => {
    expect(withInfraOrg({ url: '/api/infra/cost/overview', headers: {} }, 58).headers).toMatchObject({
      'X-Org-Id': '58',
    });
  });

  it('leaves other requests and an explicit X-Org-Id alone', () => {
    expect(withInfraOrg({ url: '/progress/tasks', headers: {} }, 58).headers).not.toHaveProperty('X-Org-Id');
    expect(withInfraOrg({ url: '/api/infra/bills', headers: { 'X-Org-Id': '9' } }, 58).headers).toMatchObject({
      'X-Org-Id': '9',
    });
    expect(withInfraOrg({ url: '/api/infra/bills', headers: {} }, undefined).headers).not.toHaveProperty(
      'X-Org-Id'
    );
  });
});

describe('infra preAction org resolution', () => {
  const env = process.env.GOOD7OB_ORG_ID;
  let setOrg: ReturnType<typeof vi.spyOn>;

  function program() {
    const p = new Command().exitOverride();
    const infra = registerInfraCommands(p);
    infra.command('probe').action(() => undefined);
    return p;
  }

  beforeEach(() => {
    delete process.env.GOOD7OB_ORG_ID;
    setOrg = vi.spyOn(apiClient, 'setInfraOrgId');
  });

  afterEach(() => {
    setOrg.mockRestore();
    if (env === undefined) {
      delete process.env.GOOD7OB_ORG_ID;
    } else {
      process.env.GOOD7OB_ORG_ID = env;
    }
  });

  it('takes --org-id given on the infra command', async () => {
    await program().parseAsync(['node', 'cli', 'infra', '--org-id', '58', 'probe']);
    expect(setOrg).toHaveBeenCalledWith(58);
  });

  it('falls back to GOOD7OB_ORG_ID', async () => {
    process.env.GOOD7OB_ORG_ID = '7';
    await program().parseAsync(['node', 'cli', 'infra', 'probe']);
    expect(setOrg).toHaveBeenCalledWith(7);
  });
});
