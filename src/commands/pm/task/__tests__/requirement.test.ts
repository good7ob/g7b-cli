/**
 * Requirement-drift guard: `--prd` source lines, `pm task requirement-check` exit codes, `requirement-ack [--rebase]`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerTaskCommands } from '../index';
import { parseSources, upsertSources } from '../requirement';
import { bizError, ok, runCli } from '../../../../utils/__tests__/cliHarness';

const register = (program: Command) => registerTaskCommands(program.command('pm'));
const task = (args: string[], responder: Parameters<typeof runCli>[2]) => runCli(register, ['pm', 'task', ...args], responder);

const PRDS: Record<string, string | null> = { 'prd-0004': '1.0.11', 'prd-0005': '2.0.0', 'prd-S440': null };

/** A platform with the given task; PUT/POST just succeed. */
const platform = (taskBody: Record<string, unknown> | null) => (method: string, url: string) => {
  if (method === 'get' && url === '/progress/tasks/7') return ok(taskBody);
  return ok({ id: 7 });
};

/** Adds the PRD lookup, answered from `lookup` (the responder only sees the url, not the keyword). */
const run = async (args: string[], taskBody: Record<string, unknown> | null = null) => {
  const r = await task(args, (m, url) => {
    if (m === 'get' && url === '/forge/prd/prds') return ok({ list: lookup(), total: 1 });
    return platform(taskBody)(m, url);
  });
  return r;
};
let lookup: () => unknown[] = () => [];
const prdRows = (...nos: string[]) => nos.filter((n) => n in PRDS).map((prdNo) => ({ prdNo, version: PRDS[prdNo] }));

afterEach(() => {
  vi.restoreAllMocks();
  lookup = () => [];
});

describe('source lines', () => {
  it('parses half-width and full-width colons and ignores other lines', () => {
    expect(parseSources('做增量\n需求来源: prd-0004@1.0.10\n  需求来源：prd-0005@2.0.0  \n需求来源 prd-9@1')).toEqual([
      { prdNo: 'prd-0004', version: '1.0.10' }, { prdNo: 'prd-0005', version: '2.0.0' },
    ]);
  });

  it('replaces a recorded PRD in place and appends new ones', () => {
    const next = upsertSources('做增量\n需求来源: prd-0004@1.0.10\n其它', [{ prdNo: 'prd-0004', version: '1.0.11' }, { prdNo: 'prd-0005', version: '2.0.0' }]);
    expect(next).toBe('做增量\n需求来源: prd-0004@1.0.11\n其它\n需求来源: prd-0005@2.0.0');
  });

  it('works on an empty description', () => {
    expect(upsertSources(undefined, [{ prdNo: 'prd-0004', version: '1.0.11' }])).toBe('需求来源: prd-0004@1.0.11');
  });
});

describe('--prd on create / update', () => {
  it('create writes the current PRD version into the description', async () => {
    lookup = () => prdRows('prd-0004');
    const r = await run(['create', '--project-id', '4', '--name', 'T', '--description', '做增量', '--prd', 'prd-0004']);
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post.mock.calls[0][1].description).toBe('做增量\n需求来源: prd-0004@1.0.11');
  });

  it('update without --description edits the description the task has now', async () => {
    lookup = () => prdRows('prd-0004');
    const r = await run(['update', '7', '--prd', 'prd-0004'], { description: '旧描述\n需求来源: prd-0004@1.0.10' });
    expect(r.http.put.mock.calls[0][1].description).toBe('旧描述\n需求来源: prd-0004@1.0.11');
  });

  it('a PRD that does not exist is an error and nothing is written', async () => {
    lookup = () => [];
    const r = await run(['create', '--project-id', '4', '--name', 'T', '--prd', 'prd-9999']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('prd-9999');
    expect(r.http.post).not.toHaveBeenCalled();
  });

  it('a PRD without a document version is an error, not a blank source line', async () => {
    lookup = () => prdRows('prd-S440');
    const r = await run(['create', '--project-id', '4', '--name', 'T', '--prd', 'prd-S440']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('正文版本');
    expect(r.http.post).not.toHaveBeenCalled();
  });
});

describe('requirement-check exit codes', () => {
  const check = (body: Record<string, unknown>, ...prds: string[]) => {
    lookup = () => prdRows(...prds);
    return run(['requirement-check', '7', '--json'], body);
  };

  it('0 when the recorded version is still the current one', async () => {
    const r = await check({ description: '需求来源: prd-0004@1.0.11' }, 'prd-0004');
    expect(r.exitCode).toBeUndefined();
    expect(JSON.parse(r.stdout)).toMatchObject({ verdict: 'consistent', exitCode: 0, sources: [{ prdNo: 'prd-0004', recorded: '1.0.11', current: '1.0.11', changed: false }] });
  });

  it('3 when the PRD moved on', async () => {
    const r = await check({ description: '需求来源: prd-0004@1.0.10' }, 'prd-0004');
    expect(r.exitCode).toBe(3);
    expect(JSON.parse(r.stdout).sources[0]).toMatchObject({ recorded: '1.0.10', current: '1.0.11', changed: true });
  });

  it('3 when the backend flagged a change even though the version line is current', async () => {
    const r = await check({ description: '需求来源: prd-0004@1.0.11', requirementChangedAt: 1793000000000, requirementChangedNote: '需求已变更：FP-2' }, 'prd-0004');
    expect(r.exitCode).toBe(3);
    expect(JSON.parse(r.stdout).changedNote).toBe('需求已变更：FP-2');
  });

  it('4 when a requirement was removed, even if a version also changed', async () => {
    const r = await check({ description: '需求来源: prd-0004@1.0.10', requirementRemovedAt: 1793000000000, requirementRemovedNote: '需求已移除（PRD 1.0.11）：FP-3' }, 'prd-0004');
    expect(r.exitCode).toBe(4);
    expect(JSON.parse(r.stdout).removedNote).toContain('FP-3');
  });

  it('5 when the task has no source line', async () => {
    const r = await check({ description: '没有来源' });
    expect(r.exitCode).toBe(5);
    expect(JSON.parse(r.stdout).verdict).toBe('no-source');
  });

  it('flags without a source line are still reported (4/3 beat 5)', async () => {
    expect((await check({ description: 'x', requirementRemovedAt: 1 })).exitCode).toBe(4);
    expect((await check({ description: 'x', requirementChangedAt: 1 })).exitCode).toBe(3);
  });

  it('a recorded PRD that can no longer be found is an error (1), never "consistent"', async () => {
    const r = await check({ description: '需求来源: prd-0009@1.0.0' });
    expect(r.exitCode).toBe(1);
  });

  it('human output names the PRD and both versions', async () => {
    lookup = () => prdRows('prd-0004');
    const r = await run(['requirement-check', '7'], { description: '需求来源: prd-0004@1.0.10' });
    expect(r.stdout).toContain('需求已变更');
    expect(r.stdout).toContain('prd-0004');
    expect(r.stdout).toContain('1.0.10');
    expect(r.stdout).toContain('1.0.11');
  });
});

describe('requirement-ack', () => {
  it('posts the ack and touches nothing else', async () => {
    const r = await run(['requirement-ack', '7']);
    expect(r.exitCode).toBeUndefined();
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks/7/requirement-ack', undefined);
    expect(r.http.put).not.toHaveBeenCalled();
  });

  it('--rebase moves the source line to the current version, then acks', async () => {
    lookup = () => prdRows('prd-0004');
    const r = await run(['requirement-ack', '7', '--rebase'], { description: '做增量\n需求来源: prd-0004@1.0.10' });
    expect(r.http.put.mock.calls[0][1]).toEqual({ description: '做增量\n需求来源: prd-0004@1.0.11' });
    expect(r.http.post).toHaveBeenCalledTimes(1);
    expect(r.http.put.mock.invocationCallOrder[0]).toBeLessThan(r.http.post.mock.invocationCallOrder[0]);
  });

  it('--rebase on a task without a source line fails and does not ack', async () => {
    const r = await run(['requirement-ack', '7', '--rebase'], { description: '没有来源' });
    expect(r.exitCode).toBe(1);
    expect(r.http.post).not.toHaveBeenCalled();
  });

  it('a failing ack is reported', async () => {
    const r = await task(['requirement-ack', '7'], () => bizError(500, 'boom'));
    expect(r.exitCode).toBe(1);
  });
});

describe('pm task get', () => {
  it('shows the flags prominently', async () => {
    const r = await run(['get', '7'], { id: 7, name: 'T', projectId: 4, requirementChangedAt: 1793000000000, requirementChangedNote: '需求已变更：FP-2', requirementRemovedAt: 1793000000000, requirementRemovedNote: '需求已移除：FP-3' });
    expect(r.stdout).toContain('⚠ 需求已变更: 需求已变更：FP-2');
    expect(r.stdout).toContain('⚠ 需求已移除: 需求已移除：FP-3');
    expect(r.stdout).toContain('requirement-check');
  });

  it('shows nothing extra when there are no flags', async () => {
    const r = await run(['get', '7'], { id: 7, name: 'T', projectId: 4 });
    expect(r.stdout).not.toContain('⚠');
  });
});
