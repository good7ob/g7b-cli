/** Thin wrapper over the `gh` CLI. execFileSync with an argv array, never a shell string. Read-only. */
import { execFileSync } from 'child_process';
import { GhPr } from './logic';

const FIELDS = 'number,title,url,state,author,additions,deletions,changedFiles,baseRefName,headRefName,createdAt,mergedAt,closedAt,updatedAt';

function gh(args: string[]): string {
  try {
    return execFileSync('gh', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer | string };
    if (err.code === 'ENOENT') throw new Error('未找到 gh 命令，请先安装 GitHub CLI（https://cli.github.com）并运行 gh auth login');
    const detail = String(err.stderr ?? '').trim();
    if (/auth login|not logged in|authentication/i.test(detail)) throw new Error('gh 尚未登录，请先运行 gh auth login');
    throw new Error(`gh ${args[0]} 调用失败: ${detail || err.message}`);
  }
}

export function ghUser(): { login: string; id: number } {
  const u = JSON.parse(gh(['api', 'user'])) as { login: string; id: number };
  return { login: u.login, id: u.id };
}

export async function ghPrList(repo: string, search: string): Promise<GhPr[]> {
  return JSON.parse(gh(['pr', 'list', '--repo', repo, '--state', 'all', '--search', search, '--json', FIELDS, '-L', '200'])) as GhPr[];
}
