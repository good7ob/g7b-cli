import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerTaskCommands } from '../index';
import { noHttpCalls, ok, runCli } from '../../../../utils/__tests__/cliHarness';
import { mergeTagNames, updateTagFields } from '../tagInput';

const register = (program: Command) => registerTaskCommands(program.command('pm'));
const run = (args: string[], response: Parameters<typeof runCli>[2] = ok({ id: 5 })) =>
  runCli(register, ['pm', 'task', ...args], response);

/** GET /progress/tasks/{id} answers with these tags; every write echoes a task. */
const withTags = (tags: string[] | Record<string, string[]>) => (method: string, url: string) => {
  if (method !== 'get') return ok({ id: 5 });
  const id = url.split('/').pop()!;
  return ok({ id: Number(id), tags: Array.isArray(tags) ? tags : tags[id] ?? [] });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pm task create --tag / --tag-id (idea #245)', () => {
  const create = (args: string[]) => run(['create', '--project-id', '4', '--name', 'T', ...args]);

  it('sends repeatable and comma-separated names, trimmed and de-duplicated', async () => {
    const r = await create(['--tag', '想法#245', '--tag', ' CLI ，backend,CLI']);
    expect(r.http.post).toHaveBeenCalledWith('/progress/tasks', expect.objectContaining({
      projectId: 4, tags: ['想法#245', 'CLI', 'backend'],
    }));
    expect(r.http.post.mock.calls[0][1]).not.toHaveProperty('tagIds');
    expect(r.exitCode).toBeUndefined();
  });

  it('sends --tag-id as numeric tagIds', async () => {
    const r = await create(['--tag-id', '66,67', '--tag-id', '66']);
    expect(r.http.post.mock.calls[0][1].tagIds).toEqual([66, 67]);
    expect(r.http.post.mock.calls[0][1]).not.toHaveProperty('tags');
  });

  it('sends no tag fields without tag options', async () => {
    const r = await create([]);
    const body = r.http.post.mock.calls[0][1];
    expect(body).not.toHaveProperty('tags');
    expect(body).not.toHaveProperty('tagIds');
  });

  it.each([
    [['--tag', 'a', '--tag-id', '1'], '不能同时使用'],
    [['--tag', 'a,,b'], '--tag'],
    [['--tag', 'x'.repeat(51)], '--tag'],
    [['--tag-id', 'abc'], '--tag-id'],
  ])('rejects %j before any request', async (args, message) => {
    const r = await create(args as string[]);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
    expect(r.stderr).toContain(message);
  });

  it('prints the tags the server stored', async () => {
    const r = await run(['create', '--project-id', '4', '--name', 'T', '--tag', 'a'], ok({ id: 9, tags: ['a'] }));
    expect(r.stdout).toContain('✓ 任务已创建: [9] T（标签: a）');
  });
});

describe('pm task update tag options (idea #245)', () => {
  it('--tag replaces the whole set without reading the task', async () => {
    const r = await run(['update', '5', '--tag', 'a,b']);
    expect(r.http.get).not.toHaveBeenCalled();
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/5', { tags: ['a', 'b'] });
    expect(r.stdout).toContain('✓ 任务已更新: 5（标签: a, b）');
  });

  it('--tag-id replaces by id', async () => {
    const r = await run(['update', '5', '--tag-id', '3']);
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/5', { tagIds: [3] });
  });

  it('--clear-tags sends an empty tagIds (an empty tags list is ignored by the server)', async () => {
    const r = await run(['update', '5', '--clear-tags']);
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/5', { tagIds: [] });
    expect(r.stdout).toContain('已清空');
  });

  it('--add-tag keeps the current tags and appends the new ones', async () => {
    const r = await run(['update', '5', '--add-tag', 'b', '--add-tag', 'c,a'], withTags(['a', 'b']));
    expect(r.http.get.mock.calls[0][0]).toBe('/progress/tasks/5');
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/5', { tags: ['a', 'b', 'c'] });
  });

  it('--remove-tag keeps the others', async () => {
    const r = await run(['update', '5', '--remove-tag', 'a'], withTags(['a', 'b']));
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/5', { tags: ['b'] });
  });

  it('removing the last tag clears through tagIds', async () => {
    const r = await run(['update', '5', '--remove-tag', 'a'], withTags(['a']));
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/5', { tagIds: [] });
  });

  it('add + remove combine with other fields in one PUT', async () => {
    const r = await run(['update', '5', '--add-tag', 'c', '--remove-tag', 'a', '--priority', 'high'], withTags(['a', 'b']));
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/5', { priority: 'high', tags: ['b', 'c'] });
  });

  it('writes nothing when the incremental change leaves the set unchanged', async () => {
    const r = await run(['update', '5', '--add-tag', 'a', '--remove-tag', 'zz'], withTags(['a']));
    expect(r.http.put).not.toHaveBeenCalled();
    expect(r.stdout).toContain('标签无变化: a');
    expect(r.exitCode).toBeUndefined();
  });

  it('still sends the other fields when the tags are unchanged', async () => {
    const r = await run(['update', '5', '--add-tag', 'a', '--priority', 'low'], withTags(['a']));
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/5', { priority: 'low' });
  });

  it('reads the task once for --prd and --add-tag together', async () => {
    const r = await run(['update', '5', '--add-tag', 'x', '--name', 'n'], withTags([]));
    expect(r.http.get).toHaveBeenCalledTimes(1);
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/5', { name: 'n', tags: ['x'] });
  });

  it.each([
    [['--tag', 'a', '--add-tag', 'b'], '整体替换'],
    [['--clear-tags', '--remove-tag', 'b'], '整体替换'],
    [['--tag', 'a', '--clear-tags'], '不能同时使用'],
    [['--tag', 'a', '--tag-id', '2'], '不能同时使用'],
    [['--add-tag', 'a', '--remove-tag', 'a'], '既 --add-tag 又 --remove-tag'],
    [['--add-tag', ' '], '--add-tag'],
  ])('rejects %j before any request', async (args, message) => {
    const r = await run(['update', '5', ...(args as string[])]);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
    expect(r.stderr).toContain(message);
  });

  it('leaves the body untouched without tag options', async () => {
    const r = await run(['update', '5', '--priority', 'high']);
    expect(r.http.get).not.toHaveBeenCalled();
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/5', { priority: 'high' });
  });
});

describe('pm task batch-update --add-tag / --remove-tag (idea #245)', () => {
  it('merges per task and skips tasks that already match', async () => {
    const r = await run(['batch-update', '--ids', '1,2,3', '--add-tag', 'x', '--remove-tag', 'old'],
      withTags({ '1': ['old'], '2': ['x'], '3': ['a', 'old'] }));
    expect(r.http.put.mock.calls).toEqual([
      ['/progress/tasks/1', { tags: ['x'] }],
      ['/progress/tasks/3', { tags: ['a', 'x'] }],
    ]);
    expect(r.stdout).toContain('✓ 已更新 2 个任务的标签（+x -old），1 个无变化');
  });

  it('also runs the batch update when other fields are given', async () => {
    const r = await run(['batch-update', '--ids', '1', '--add-tag', 'x', '--status', 'in_progress'], withTags({ '1': [] }));
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/1', { tags: ['x'] });
    expect(r.http.put).toHaveBeenCalledWith('/progress/tasks/batch', { taskIds: [1], status: 'in_progress' });
  });

  it('rejects the same tag added and removed', async () => {
    const r = await run(['batch-update', '--ids', '1', '--add-tag', 'x', '--remove-tag', 'x']);
    expect(r.exitCode).toBe(1);
    expect(noHttpCalls(r)).toBe(true);
  });
});

describe('pm task list --tag (idea #245)', () => {
  it('merges --tag with --tags into the tags query param', async () => {
    const r = await run(['list', '4', '--tags', 'a,b', '--tag', 'c', '--tag', 'a'], ok([]));
    expect(r.http.get.mock.calls[0][1].params.tags).toBe('a,b,c');
  });

  it('sends no tags param without tag filters', async () => {
    const r = await run(['list', '4'], ok([]));
    expect(r.http.get.mock.calls[0][1].params).not.toHaveProperty('tags');
  });
});

describe('tag set helpers', () => {
  it('mergeTagNames keeps order and appends additions', () => {
    expect(mergeTagNames(['a', 'b', 'c'], { addTag: ['d', 'a'], removeTag: ['b'] })).toEqual(['a', 'c', 'd']);
  });

  it('updateTagFields returns {} without tag options', () => {
    expect(updateTagFields({})).toEqual({});
  });
});
