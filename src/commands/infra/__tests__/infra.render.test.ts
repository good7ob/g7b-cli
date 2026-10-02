/**
 * Regression tests for two bugs found while importing the dev AWS inventory
 * (2026-09-21), both in the list renderers of the infra command group:
 *
 * 1. `infra resource list` crashed with "Cannot read properties of null
 *    (reading 'padEnd')" — `infra_resource` rows legitimately carry null
 *    resourceName / environment / status, and the renderer called `.padEnd`
 *    straight on them.
 * 2. `--json` / `--csv` output was followed by a human-readable
 *    "显示第 N 页，共 M 页" line whenever total > pageSize, so the output could
 *    not be parsed by anything downstream.
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import { registerInfraCommands } from '../index';
import { ok, runCli } from '../../../utils/__tests__/cliHarness';

afterEach(() => vi.restoreAllMocks());

/** A page of results where `total` exceeds `pageSize`, which is what triggered bug 2. */
const page = (records: unknown[]) => ok({ records, total: 539, pageNo: 1, pageSize: 20 });

const NULL_HEAVY_RESOURCE = {
  id: 7,
  resourceId: 'arn:aws:ec2:ap-northeast-1:964727750692:vpc/vpc-0ba4f8998bc293842',
  resourceName: null,
  resourceType: null,
  cloudProvider: 'aws',
  environment: null,
  status: null,
  monthlyCost: null,
};

describe('infra resource list', () => {
  it('renders rows whose name / environment / status are null instead of crashing', async () => {
    const r = await runCli(registerInfraCommands, ['infra', 'resource', 'list'], page([NULL_HEAVY_RESOURCE]));

    expect(r.exitCode).toBeUndefined();
    expect(r.stderr).not.toContain('padEnd');
    expect(r.stdout).toContain('云资源列表');
    expect(r.stdout).toContain('—'); // dash() placeholder for the null columns
  });

  it('keeps --json parseable when there is more than one page', async () => {
    const r = await runCli(
      registerInfraCommands,
      ['infra', 'resource', 'list', '--json'],
      page([NULL_HEAVY_RESOURCE])
    );

    expect(r.exitCode).toBeUndefined();
    expect(r.stdout).not.toContain('显示第');
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(JSON.parse(r.stdout).total).toBe(539);
  });

  it('keeps --csv free of the pagination footer too', async () => {
    const r = await runCli(
      registerInfraCommands,
      ['infra', 'resource', 'list', '--csv'],
      page([NULL_HEAVY_RESOURCE])
    );

    expect(r.stdout).not.toContain('显示第');
    expect(r.stdout.split('\n')[0]).toContain('资源ID');
  });

  it('still prints the pagination hint for the plain human output', async () => {
    const r = await runCli(registerInfraCommands, ['infra', 'resource', 'list'], page([NULL_HEAVY_RESOURCE]));
    expect(r.stdout).toContain('显示第 1 页');
  });
});

describe('infra bill list', () => {
  it('survives null provider / status and keeps --json parseable', async () => {
    const bill = {
      id: 3,
      month: null,
      cloudProvider: null,
      status: null,
      recordCount: null,
      totalCost: 0,
      createdAt: null,
    };

    const text = await runCli(registerInfraCommands, ['infra', 'bill', 'list'], page([bill]));
    expect(text.exitCode).toBeUndefined();
    expect(text.stderr).not.toContain('padEnd');

    const json = await runCli(registerInfraCommands, ['infra', 'bill', 'list', '--json'], page([bill]));
    expect(json.stdout).not.toContain('显示第');
    expect(() => JSON.parse(json.stdout)).not.toThrow();
  });
});

describe('infra app list', () => {
  it('survives null name / environment / status', async () => {
    const app = { id: 1, name: null, environment: null, status: null, ownerId: null, createdAt: null };
    const r = await runCli(registerInfraCommands, ['infra', 'app', 'list'], page([app]));

    expect(r.exitCode).toBeUndefined();
    expect(r.stderr).not.toContain('padEnd');
  });
});
