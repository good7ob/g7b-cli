/**
 * Task tag options of `pm task create / update / batch-update / list` (idea #245).
 *
 * The backend resolves tag NAMES itself (TaskService.syncTaskTags → findOrCreateTagByName): a name that is
 * neither a system tag nor one of the caller's own tags is created as the caller's tag, the same as the web
 * TagSelector does. A PUT that carries `tags` or `tagIds` REPLACES the task's whole tag set, so the
 * incremental `--add-tag / --remove-tag` read the current names first and send the merged set.
 */
import { InputError, parseId } from '../../../utils/cliHelpers';

/** pm_tag.name is varchar(50). */
export const MAX_TAG_NAME = 50;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Commander collector: `--tag a --tag b,c` (also `，`) -> ['a', 'b', 'c']; blanks are kept for validation. */
export const collectTagList = (value: string, prev: string[] = []): string[] => [...prev, ...value.split(/[,，]/)];

/** Trim, validate and de-duplicate tag names (case is kept: tags are matched by exact name). */
export function normalizeTagNames(raw: string[] | undefined, label: string): string[] {
  const names: string[] = [];
  for (const item of raw ?? []) {
    const name = item.trim();
    if (!name || name.length > MAX_TAG_NAME || CONTROL_CHARS.test(name)) {
      throw new InputError(`${label} 每项必须是 1~${MAX_TAG_NAME} 个字符且不含控制字符，收到: ${name || '(空)'}`);
    }
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

function tagIds(raw: string[] | undefined): number[] {
  return Array.from(new Set((raw ?? []).map((v) => parseId(v.trim(), '--tag-id'))));
}

export interface TagOptions {
  tag?: string[];
  tagId?: string[];
  addTag?: string[];
  removeTag?: string[];
  clearTags?: boolean;
}

const has = (list?: string[]) => Boolean(list && list.length);

/** `pm task create`: `--tag` names (created when missing) or `--tag-id` ids, never both. */
export function createTagFields(options: TagOptions): { tags?: string[]; tagIds?: number[] } {
  if (has(options.tag) && has(options.tagId)) throw new InputError('--tag 与 --tag-id 不能同时使用');
  if (has(options.tagId)) return { tagIds: tagIds(options.tagId) };
  const tags = normalizeTagNames(options.tag, '--tag');
  return tags.length ? { tags } : {};
}

/** Whether the update must read the task's current tags first (incremental change). */
export function needsCurrentTags(options: TagOptions): boolean {
  return has(options.addTag) || has(options.removeTag);
}

/** Whether any tag option was given to `pm task update`. */
export function hasTagChange(options: TagOptions): boolean {
  return has(options.tag) || has(options.tagId) || Boolean(options.clearTags) || needsCurrentTags(options);
}

/**
 * Validate the update tag options before any HTTP call: `--tag` / `--tag-id` / `--clear-tags` replace the whole
 * set and exclude each other and `--add-tag / --remove-tag`; add and remove may be combined.
 */
export function checkUpdateTagOptions(options: TagOptions): void {
  const replacing = [
    has(options.tag) && '--tag',
    has(options.tagId) && '--tag-id',
    options.clearTags && '--clear-tags',
  ].filter(Boolean) as string[];
  if (replacing.length > 1) throw new InputError(`${replacing.join(' / ')} 不能同时使用`);
  if (replacing.length && needsCurrentTags(options)) {
    throw new InputError(`${replacing[0]} 会整体替换标签，不能与 --add-tag / --remove-tag 同时使用`);
  }
  const add = normalizeTagNames(options.addTag, '--add-tag');
  const remove = normalizeTagNames(options.removeTag, '--remove-tag');
  const both = add.filter((t) => remove.includes(t));
  if (both.length) throw new InputError(`同一个标签不能既 --add-tag 又 --remove-tag: ${both.join(', ')}`);
  normalizeTagNames(options.tag, '--tag');
  tagIds(options.tagId);
}

/** Current tag names as returned by GET /progress/tasks/{id} (`tags: string[]`). */
export function currentTagNames(task: any): string[] {
  const tags = Array.isArray(task?.tags) ? task.tags : [];
  return tags.map((t: any) => String(typeof t === 'string' ? t : t?.name ?? '').trim()).filter(Boolean);
}

/** The tag set after `--add-tag / --remove-tag` on top of the current names (order kept, additions appended). */
export function mergeTagNames(current: string[], options: TagOptions): string[] {
  const remove = normalizeTagNames(options.removeTag, '--remove-tag');
  const next = current.filter((t) => !remove.includes(t));
  for (const t of normalizeTagNames(options.addTag, '--add-tag')) if (!next.includes(t)) next.push(t);
  return next;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((t) => b.includes(t));

/**
 * PUT body fields for the tag options. `current` is required for --add-tag / --remove-tag. Returns null when an
 * incremental change leaves the set as it is (nothing to send). An empty result set is sent as `tagIds: []`,
 * because the backend ignores an empty `tags` list (only a non-null `tagIds` clears the associations).
 */
export function updateTagFields(
  options: TagOptions,
  current?: string[]
): { tags?: string[]; tagIds?: number[] } | null {
  if (!hasTagChange(options)) return {};
  if (options.clearTags) return { tagIds: [] };
  if (has(options.tagId)) return { tagIds: tagIds(options.tagId) };
  if (has(options.tag)) return { tags: normalizeTagNames(options.tag, '--tag') };
  const before = current ?? [];
  const next = mergeTagNames(before, options);
  if (sameSet(before, next)) return null;
  return next.length ? { tags: next } : { tagIds: [] };
}

/** `pm task list --tag a --tag b` merged with the older `--tags a,b` into the backend `tags` query param. */
export function listTagParam(options: { tags?: string; tag?: string[] }): string | undefined {
  const raw = [...(options.tags ? options.tags.split(/[,，]/) : []), ...(options.tag ?? [])];
  const names = normalizeTagNames(raw.filter((t) => t.trim()), '--tag');
  return names.length ? names.join(',') : undefined;
}
