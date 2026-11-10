import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../ConfigService';

const posix = process.platform !== 'win32';
const mode = (p: string) => fs.statSync(p).mode & 0o777;

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-cfg-'));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe.runIf(posix)('config file permissions', () => {
  it('creates the directory and the file owner-only', () => {
    new ConfigService({ homeDir: home }).set('apiKey', 'k');
    expect(mode(path.join(home, '.good7ob'))).toBe(0o700);
    expect(mode(path.join(home, '.good7ob', 'config.json'))).toBe(0o600);
  });

  it('tightens a directory and file left world-readable by an older version', () => {
    const dir = path.join(home, '.good7ob');
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'config.json'), '{"apiKey":"old"}', { mode: 0o644 });
    fs.chmodSync(dir, 0o755);
    fs.chmodSync(path.join(dir, 'config.json'), 0o644);

    new ConfigService({ homeDir: home }).set('orgId', 1);

    expect(mode(dir)).toBe(0o700);
    expect(mode(path.join(dir, 'config.json'))).toBe(0o600);
  });
});
