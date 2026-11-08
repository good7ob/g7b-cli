/**
 * Effective lines of a pull request = main code + tests + SQL migrations, with docs, config, lockfiles and build output
 * left out. GitHub only reports a PR's total lines, so the per-file split can only happen here, where `gh` can list files.
 * Basis matches 评估/2026-11-02-有效代码提交统计 (口径 section).
 */
export interface PrFile { path: string; additions: number; deletions: number }
export interface EffectiveLines { additions: number; deletions: number }

/** The REST files endpoint stops at 3000 files; a PR that large cannot be classified completely. */
export const REST_FILE_LIMIT = 3000;

const NOISE = new RegExp([
  String.raw`(^|/)(node_modules|dist|build|target|\.next|coverage|__snapshots__)/`,
  String.raw`(^|/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|pubspec\.lock|Podfile\.lock)$`,
  String.raw`(^|/)db/baseline/`,
  String.raw`(^|/)static/highlight/`,
  String.raw`\.(min\.js|map|svg|png|jpe?g|gif|ico|webp|pdf|woff2?|ttf|eot|jar|zip)$`,
].join('|'));
const CODE_EXT = /\.(java|vue|ts|tsx|js|mjs|css|scss|py|dart|kt|swift|m|h)$/;
const TEST_DIR = /(^|\/)(src\/test|__tests__|e2e|tests|integration_test)\//;
const TEST_NAME = /(\.(spec|test)\.[a-z]+$|_test\.dart$|\.feature$)/;

/** 'ignore' covers docs, config and noise. */
export function classify(path: string): 'main' | 'test' | 'sql' | 'ignore' {
  if (NOISE.test(path)) return 'ignore';
  if (path.endsWith('.sql')) return 'sql';
  if (path.endsWith('.feature') || TEST_NAME.test(path)) return 'test';
  if (CODE_EXT.test(path)) return TEST_DIR.test(path) ? 'test' : 'main';
  return 'ignore';
}

export function sumEffective(files: readonly PrFile[]): EffectiveLines {
  return files.reduce<EffectiveLines>((t, f) => (classify(f.path) === 'ignore'
    ? t : { additions: t.additions + f.additions, deletions: t.deletions + f.deletions }), { additions: 0, deletions: 0 });
}

/**
 * Effective lines for one PR, or null when the file list cannot be completed. `listed` is what `gh pr list` returned,
 * which GitHub truncates for big PRs; a short list is completed through `fetchAll` (REST, paginated).
 */
export async function effectiveOf(
  listed: readonly PrFile[] | undefined,
  changedFiles: number,
  fetchAll: () => Promise<PrFile[]>,
): Promise<EffectiveLines | null> {
  if (listed && listed.length >= changedFiles) return sumEffective(listed);
  if (changedFiles >= REST_FILE_LIMIT) return null;
  const all = await fetchAll();
  return all.length >= changedFiles ? sumEffective(all) : null;
}
