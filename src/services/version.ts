/**
 * The CLI's own version and the forced-upgrade notice.
 *
 * The version has one source, package.json; it is what `--version` prints and what every request reports as
 * `User-Agent: good7ob-cli/<version>`. The backend can set a minimum version: an older CLI is answered with
 * HTTP 426 and `{ code: 426, data: { currentVersion, minVersion } }`, and the command stops with the notice below.
 */

import * as fs from 'fs';
import * as path from 'path';

const INSTALL_ROOT = path.resolve(__dirname, '..', '..');

export const UPGRADE_REQUIRED = 426;

function readVersion(root: string): string {
  try {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version;
    return typeof version === 'string' && version ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const CLI_VERSION: string = readVersion(INSTALL_ROOT);
export const USER_AGENT = `good7ob-cli/${CLI_VERSION}`;

/** How to upgrade this install: a git clone pulls and rebuilds, anything else is reinstalled. */
export function upgradeSteps(root: string = INSTALL_ROOT): string {
  return fs.existsSync(path.join(root, '.git'))
    ? `cd ${JSON.stringify(root)} && git pull && npm install && npm run build`
    : '重新安装最新版本的 good7ob CLI';
}

/** The notice for a "CLI too old" answer, or null for any other response. */
export function upgradeNotice(response: { status?: number; data?: any } | undefined, root: string = INSTALL_ROOT): string | null {
  if (response?.status !== UPGRADE_REQUIRED || response.data?.code !== UPGRADE_REQUIRED) return null;
  const min = response.data?.data?.minVersion;
  return [
    `✗ good7ob CLI 版本过低：当前 ${CLI_VERSION}${typeof min === 'string' && min ? `，服务端要求最低 ${min}` : ''}。命令没有执行。`,
    `  升级：${upgradeSteps(root)}`,
  ].join('\n');
}
