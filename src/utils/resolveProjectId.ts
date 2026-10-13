import configService from '../services/ConfigService';

/**
 * Resolve the project a `pm`/`prd` command works in: explicit argument/option, then
 * `GOOD7OB_PROJECT_ID`, then the project remembered by `good7ob pm project use <id>`.
 */
export function resolveProjectId(
  explicit: string | number | undefined,
  configured: number | undefined,
  env: NodeJS.ProcessEnv = process.env
): { id: number; fromDefault: boolean } {
  const raw = explicit ?? env.GOOD7OB_PROJECT_ID ?? configured;
  const id = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('缺少项目：请传项目号、设置环境变量 GOOD7OB_PROJECT_ID，或先运行 `good7ob pm project use <id>`');
  }
  return { id, fromDefault: explicit === undefined };
}

/** Command-side wrapper: reads config, and tells stderr when the remembered project was used. */
export function currentProjectId(explicit?: string | number): number {
  const { id, fromDefault } = resolveProjectId(explicit, configService.get('projectId'));
  if (fromDefault) console.error(`ℹ 使用当前项目 ${id}`);
  return id;
}
