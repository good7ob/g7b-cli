/**
 * Resolve the organization an infra command works in (g7b#1408).
 *
 * The backend scopes the application list to one organization and rejects calls without one,
 * so the CLI needs an explicit org: `--org-id`, then `GOOD7OB_ORG_ID`, then `config set org-id`.
 */
export function resolveOrgId(
  option: string | number | undefined,
  configured: number | undefined,
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = option ?? env.GOOD7OB_ORG_ID ?? configured;
  const orgId = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(orgId) || orgId <= 0) {
    throw new Error('缺少组织：请使用 --org-id <id>、环境变量 GOOD7OB_ORG_ID，或 `good7ob config set org-id <id>`');
  }
  return orgId;
}
