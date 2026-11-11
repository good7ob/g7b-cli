/**
 * Bug 2119700413758672898: `infra app bind-resource` must send {resourceIds, relationType, replace} (backend#1222),
 * not the bare id array that made every binding "primary"; snowflake resource ids must stay exact.
 */
import { describe, expect, it } from 'vitest';
import { ok, runCli } from '../../../utils/__tests__/cliHarness';
import { registerInfraCommands } from '..';

const URL = '/api/infra/applications/2119699347172331521/resources';

describe('infra app bind-resource', () => {
  it('sends relationType and replace with the ids', async () => {
    const r = await runCli(registerInfraCommands, ['infra', '--org-id', '58', 'app', 'bind-resource',
      '2119699347172331521', '--resource-ids', '2119699347172331599, 42', '--relation-type', 'dependency',
      '--replace'], ok(null));
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post).toHaveBeenCalledWith(URL, {
      resourceIds: ['2119699347172331599', '42'],
      relationType: 'dependency',
      replace: true,
    });
  });

  it('defaults to primary, incremental', async () => {
    const r = await runCli(registerInfraCommands, ['infra', '--org-id', '58', 'app', 'bind-resource',
      '2119699347172331521', '--resource-ids', '7'], ok(null));
    expect(r.http.post).toHaveBeenCalledWith(URL, { resourceIds: ['7'], relationType: 'primary', replace: false });
  });

  it('rejects an unknown relation type without calling the API', async () => {
    const r = await runCli(registerInfraCommands, ['infra', '--org-id', '58', 'app', 'bind-resource',
      '2119699347172331521', '--resource-ids', '7', '--relation-type', 'owner'], ok(null));
    expect(r.exitCode).toBe(1);
    expect(r.http.post).not.toHaveBeenCalled();
  });
});
