/** The two git facts `artifact sync` needs; isolated so tests can replace them. */
import { execFileSync } from 'child_process';

function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export const remoteUrl = (dir: string): string | null => git(dir, ['remote', 'get-url', 'origin']);

export const headSha = (dir: string): string | null => git(dir, ['rev-parse', 'HEAD']);
