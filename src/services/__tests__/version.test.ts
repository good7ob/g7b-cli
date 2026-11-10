import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLI_VERSION, USER_AGENT, upgradeNotice, upgradeSteps } from '../version';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-ver-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('CLI version', () => {
  it('comes from package.json and is what the User-Agent reports', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf-8'));
    expect(CLI_VERSION).toBe(pkg.version);
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(USER_AGENT).toBe(`good7ob-cli/${pkg.version}`);
  });
});

describe('upgradeNotice', () => {
  const tooOld = { status: 426, data: { code: 426, msg: 'x', data: { currentVersion: '0.2.0', minVersion: '9.0.0' } } };

  it('names both versions and the upgrade steps for a git clone', () => {
    fs.mkdirSync(path.join(root, '.git'));
    const notice = upgradeNotice(tooOld, root) as string;
    expect(notice).toContain(`当前 ${CLI_VERSION}`);
    expect(notice).toContain('最低 9.0.0');
    expect(notice).toContain(`cd ${JSON.stringify(root)} && git pull && npm install && npm run build`);
  });

  it('asks for a reinstall when the install is not a git clone', () => {
    expect(upgradeSteps(root)).toBe('重新安装最新版本的 good7ob CLI');
  });

  it('still gives a notice when the server sent no minimum', () => {
    expect(upgradeNotice({ status: 426, data: { code: 426 } }, root)).toContain('版本过低');
  });

  it('is null for every other response', () => {
    expect(upgradeNotice(undefined, root)).toBeNull();
    expect(upgradeNotice({ status: 401, data: { code: 401 } }, root)).toBeNull();
    expect(upgradeNotice({ status: 426, data: 'Upgrade Required' }, root)).toBeNull();
    expect(upgradeNotice({ status: 200, data: { code: 426 } }, root)).toBeNull();
  });
});
