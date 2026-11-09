import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../ConfigService';
import { dataDir, FLAVOR_FILE, loadFlavor, PROD_API_URL } from '../flavor';

const DEV = { name: 'dev', apiUrl: 'https://api-dev.good7ob.net' };

describe('flavor: a release install is prod, a dev clone opts in with dev-env.json', () => {
  let root: string;
  let home: string;
  const writeFlavor = (content: unknown) =>
    fs.writeFileSync(path.join(root, FLAVOR_FILE), typeof content === 'string' ? content : JSON.stringify(content));

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-root-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-home-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('is prod without the file, with data in ~/.good7ob', () => {
    const flavor = loadFlavor(root);
    expect(flavor).toEqual({ name: 'prod', apiUrl: PROD_API_URL });
    expect(dataDir(flavor, home)).toBe(path.join(home, '.good7ob'));
  });

  it("is the file's environment with its own data dir, trailing slash dropped", () => {
    writeFlavor({ ...DEV, apiUrl: `${DEV.apiUrl}/` });
    const flavor = loadFlavor(root);
    expect(flavor).toEqual(DEV);
    expect(dataDir(flavor, home)).toBe(path.join(home, '.good7ob-dev'));
  });

  it.each([
    ['not json', '{oops'],
    ['name prod', { name: 'prod', apiUrl: DEV.apiUrl }],
    ['bad name', { name: 'Dev Env', apiUrl: DEV.apiUrl }],
    ['no url', { name: 'dev' }],
    ['non-http url', { name: 'dev', apiUrl: 'ftp://x' }],
  ])('rejects a broken file: %s', (_label, content) => {
    writeFlavor(content);
    expect(() => loadFlavor(root)).toThrow(FLAVOR_FILE);
  });

  it('cannot switch a release: the file is neither tracked nor in the npm package', () => {
    const repo = path.resolve(__dirname, '..', '..', '..');
    expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf-8')).toContain(FLAVOR_FILE);
    const files: string[] = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf-8')).files;
    expect(files).not.toContain(FLAVOR_FILE);
  });
});

describe('ConfigService follows the flavor', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-home-'));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  const prod = { name: 'prod', apiUrl: PROD_API_URL };
  const writeConfig = (dir: string, cfg: unknown) => {
    fs.mkdirSync(path.join(home, dir), { recursive: true });
    fs.writeFileSync(path.join(home, dir, 'config.json'), JSON.stringify(cfg));
  };
  const readConfig = (dir: string) => JSON.parse(fs.readFileSync(path.join(home, dir, 'config.json'), 'utf-8'));

  it('prod: the address is fixed whatever the file says, and a leftover non-prod apiUrl is called out', () => {
    writeConfig('.good7ob', { apiUrl: DEV.apiUrl, apiKey: 'k', orgId: 1 });
    const c = new ConfigService({ homeDir: home, flavor: prod });
    expect(c.get('apiUrl')).toBe(PROD_API_URL);
    expect(c.getAll().apiUrl).toBe(PROD_API_URL);
    expect(c.get('apiKey')).toBe('k');
    expect(c.notices.join('\n')).toContain(DEV.apiUrl);
    expect(() => c.set('apiUrl', DEV.apiUrl)).toThrow(PROD_API_URL);
    expect(() => c.set('apiUrl', PROD_API_URL)).not.toThrow();
  });

  it('prod: quiet when the file is clean', () => {
    writeConfig('.good7ob', { apiUrl: PROD_API_URL, apiKey: 'k' });
    expect(new ConfigService({ homeDir: home, flavor: prod }).notices).toEqual([]);
  });

  it('dev: talks to dev with its own config, leaves the prod config alone, and says so on stderr', () => {
    writeConfig('.good7ob', { apiKey: 'prod-key', orgId: 1 });
    const c = new ConfigService({ homeDir: home, flavor: DEV });
    expect(c.get('apiUrl')).toBe(DEV.apiUrl);
    expect(c.get('apiKey')).toBe('');
    expect(c.get('orgId')).toBeUndefined();
    expect(c.activeEnvironment()).toBe('dev');
    expect(c.notices.join('\n')).toContain('dev');

    c.set('apiKey', 'dev-key');
    c.set('orgId', 58);
    expect(readConfig('.good7ob-dev')).toMatchObject({ apiKey: 'dev-key', orgId: 58 });
    expect(readConfig('.good7ob')).toEqual({ apiKey: 'prod-key', orgId: 1 });
  });
});
