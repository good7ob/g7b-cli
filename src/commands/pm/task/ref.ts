import apiClient from '../../../services/ApiClient';
import configService from '../../../services/ConfigService';
import { InputError, parseId } from '../../../utils/cliHelpers';

/**
 * g7b #3274 (api-0190 §7.1): a task ref like `1600-3` (parent task number + sub-task sequence) is not an internal
 * id. `get` / `update` / `delete` turn it into one through GET /progress/tasks/by-no; a bare number stays the
 * internal id and never reaches by-no.
 */
const DISPLAY_NO_REF = /^#?(\d+-\d+)$/;

export interface RefOptions {
  org?: string;
  project?: string;
}

export type RefScope = { orgId: number } | { projectId: number };

export function isDisplayNoRef(ref: string): boolean {
  return DISPLAY_NO_REF.test(ref);
}

/**
 * Which organization the number is unique in: --org, or --project (its organization), else the current project
 * (GOOD7OB_PROJECT_ID, then `pm project use`), else the current organization (GOOD7OB_ORG_ID, then `config set org-id`).
 */
export function pickScope(
  options: RefOptions,
  configured: { projectId?: number; orgId?: number },
  env: NodeJS.ProcessEnv = process.env
): RefScope {
  if (options.org !== undefined && options.project !== undefined) {
    throw new InputError('--org 与 --project 只能二选一');
  }
  if (options.org !== undefined) return { orgId: parseId(options.org, '--org') };
  if (options.project !== undefined) return { projectId: parseId(options.project, '--project') };
  const project = env.GOOD7OB_PROJECT_ID ?? configured.projectId;
  if (project !== undefined) return { projectId: parseId(String(project), 'GOOD7OB_PROJECT_ID') };
  const org = env.GOOD7OB_ORG_ID ?? configured.orgId;
  if (org !== undefined) return { orgId: parseId(String(org), 'GOOD7OB_ORG_ID') };
  throw new InputError(
    '任务号只在组织内唯一，需要知道组织：请加 --org <组织号> 或 --project <项目号>，' +
      '或先运行 `good7ob pm project use <id>`'
  );
}

/** What the command works on: the internal id, plus the task when by-no already returned it. */
export interface ResolvedTask {
  id: string;
  task?: any;
}

export async function resolveTaskRef(ref: string, options: RefOptions): Promise<ResolvedTask> {
  const match = DISPLAY_NO_REF.exec(ref);
  if (!match) return { id: ref };
  const scope = pickScope(options, { projectId: configService.get('projectId'), orgId: configService.get('orgId') });
  const task = await apiClient.get('/progress/tasks/by-no', { no: match[1], ...scope });
  return { id: String(task.id), task };
}

/** One stderr line naming the task a display number resolved to, so a write never lands on a guessed task. */
export function describeResolved(ref: string, resolved: ResolvedTask): string | undefined {
  const t = resolved.task;
  if (!t) return undefined;
  return `ℹ ${ref} → 任务 ${t.id}「${t.name}」（项目 ${t.projectId}）`;
}
