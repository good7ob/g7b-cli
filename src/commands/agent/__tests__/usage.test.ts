import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildEffortBody } from '../../pm/task/time';
import {
  findLatestTranscript, parseTranscript, traceTasks, projectDirName, toEffortOptions, UsageMemo, usageSessionKey, withStopHook,
} from '../usage';

const line = (id: string, ts: string, usage: object, model = 'claude-sonnet-5-5') =>
  JSON.stringify({ type: 'assistant', timestamp: ts, uuid: `u-${id}-${ts}`, message: { id, model, usage } });
const U = (i: number, o: number, r = 0, w = 0) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: r, cache_creation_input_tokens: w });

describe('parseTranscript', () => {
  it('counts a message id once even when written per content block', () => {
    const t = [line('m1', '2026-11-16T01:00:00Z', U(2, 100, 50, 10)), line('m1', '2026-11-16T01:00:01Z', U(2, 100, 50, 10))].join('\n');
    const u = parseTranscript(t);
    expect(u).toMatchObject({ inputTokens: 2, outputTokens: 100, cacheReadTokens: 50, cacheWriteTokens: 10, messageCount: 1 });
  });

  it('sums distinct messages, picks the dominant model and skips junk lines', () => {
    const t = [
      line('m1', '2026-11-16T01:00:00Z', U(1, 10), 'haiku'),
      '{ half written',
      JSON.stringify({ type: 'user', timestamp: '2026-11-16T01:00:30Z' }),
      line('m2', '2026-11-16T01:01:00Z', U(5, 500), 'opus'),
    ].join('\n');
    const u = parseTranscript(t);
    expect(u).toMatchObject({ inputTokens: 6, outputTokens: 510, modelCode: 'opus', messageCount: 2 });
    expect(u.endedAt! - u.startedAt!).toBe(60_000);
  });

  it('only counts messages since the task was claimed and ignores long idle gaps in work time', () => {
    const t = [
      line('old', '2026-11-16T00:00:00Z', U(100, 100)),
      line('a', '2026-11-16T01:00:00Z', U(1, 1)),
      line('b', '2026-11-16T01:02:00Z', U(1, 1)),
      line('c', '2026-11-16T03:00:00Z', U(1, 1)), // 2h later: idle
    ].join('\n');
    const u = parseTranscript(t, Date.parse('2026-11-16T00:30:00Z'));
    expect(u.inputTokens).toBe(3);
    expect(u.workSeconds).toBe(120);
  });

  it('reports zero messages for an empty window', () => {
    expect(parseTranscript('').messageCount).toBe(0);
  });
});

describe('effort body', () => {
  it('turns usage into a valid hook_trace effort body', () => {
    const u = parseTranscript(line('m1', '2026-11-16T01:00:00Z', U(2, 100, 50, 10)) + '\n' + line('m2', '2026-11-16T01:01:00Z', U(1, 1)));
    const body = buildEffortBody(toEffortOptions(u, 2592, usageSessionKey('abc', 2592)));
    expect(body).toMatchObject({
      taskId: 2592, sourceType: 'hook_trace', executorType: 'AGENT', agentName: 'claude-code', sessionId: 'cc-abc-t2592',
      inputTokens: 3, outputTokens: 101, cacheReadTokens: 50, cacheWriteTokens: 10, modelCode: 'claude-sonnet-5-5', workSeconds: 60,
    });
  });
});

describe('transcript discovery', () => {
  it('encodes the project dir like Claude Code and finds the newest transcript', () => {
    expect(projectDirName('/Users/a b/x_y')).toBe('-Users-a-b-x-y');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-usage-'));
    const dir = path.join(home, '.claude', 'projects', projectDirName('/work/p'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'old.jsonl'), '');
    fs.utimesSync(path.join(dir, 'old.jsonl'), 1, 1);
    fs.writeFileSync(path.join(dir, 'new.jsonl'), '');
    expect(findLatestTranscript('/work/p', home)).toBe(path.join(dir, 'new.jsonl'));
    expect(findLatestTranscript('/nope', home)).toBeUndefined();
  });
});

describe('UsageMemo', () => {
  it('round-trips a target and ignores corrupt files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-memo-'));
    const memo = new UsageMemo(dir);
    expect(memo.read('s1')).toBeUndefined();
    memo.write('s1', { taskId: 7, sinceMs: 123 });
    expect(memo.read('s1')).toEqual({ taskId: 7, sinceMs: 123 });
    fs.writeFileSync(path.join(dir, 's2.json'), 'garbage');
    expect(memo.read('s2')).toBeUndefined();
  });
});

describe('withStopHook', () => {
  it('adds the hook once and keeps other settings', () => {
    const first = withStopHook({ model: 'sonnet', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } });
    expect(first.changed).toBe(true);
    expect(first.settings.model).toBe('sonnet');
    expect(first.settings.hooks.Stop).toHaveLength(2);
    expect(withStopHook(first.settings).changed).toBe(false);
  });
  it('works on empty settings', () => {
    expect(withStopHook({}).settings.hooks.Stop[0].hooks[0].command).toBe('good7ob agent report-usage --hook');
  });
});

describe('traceTasks', () => {
  it('reads refs.tasks of the session summary, deduped, and tolerates missing or broken files', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-trace-'));
    const dir = path.join(cwd, '.claude', 'trace');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 's1.summary.json'), JSON.stringify({ refs: { tasks: [1583, '1583', 7] } }));
    fs.writeFileSync(path.join(dir, 's2.summary.json'), '{broken');
    expect(traceTasks(cwd, 's1')).toEqual([1583, 7]);
    expect(traceTasks(cwd, 's2')).toEqual([]);
    expect(traceTasks(cwd, 'nope')).toEqual([]);
  });
});
