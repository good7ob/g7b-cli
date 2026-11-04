import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService, PROD_API_URL } from '../ConfigService';

const DEV_URL = 'https://api-dev.good7ob.net';

describe('ConfigService environments: release build is fixed to prod, others opt in by GOOD7OB_ENV', () => {
  let home: string;

  const writeFile = (cfg: unknown) => {
    fs.mkdirSync(path.join(home, '.good7ob'), { recursive: true });
    fs.writeFileSync(path.join(home, '.good7ob', 'config.json'), JSON.stringify(cfg), 'utf-8');
  };
  const readFile = () => JSON.parse(fs.readFileSync(path.join(home, '.good7ob', 'config.json'), 'utf-8'));
  const make = (env: Record<string, string> = {}) => new ConfigService({ homeDir: home, env });

  const both = {
    apiUrl: PROD_API_URL,
    apiKey: 'prod-key',
    orgId: 1,
    projectId: 10,
    environments: { dev: { apiUrl: DEV_URL, apiKey: 'dev-key', orgId: 58, projectId: 4 } },
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-env-'));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('uses the fixed prod URL by default, whatever the file says', () => {
    writeFile({ ...both, apiUrl: DEV_URL });
    const c = make();
    expect(c.get('apiUrl')).toBe(PROD_API_URL);
    expect(c.get('apiKey')).toBe('prod-key');
    expect(c.get('orgId')).toBe(1);
    expect(c.activeEnvironment()).toBe('prod');
  });

  it('tells the user a leftover non-prod apiUrl in the file is ignored', () => {
    writeFile({ ...both, apiUrl: DEV_URL });
    expect(make().notices.join('\n')).toContain(DEV_URL);
    writeFile(both);
    expect(make().notices).toEqual([]);
  });

  it('GOOD7OB_ENV=dev switches url, key, org and project together', () => {
    writeFile(both);
    const c = make({ GOOD7OB_ENV: 'dev' });
    expect(c.get('apiUrl')).toBe(DEV_URL);
    expect(c.get('apiKey')).toBe('dev-key');
    expect(c.get('orgId')).toBe(58);
    expect(c.get('projectId')).toBe(4);
    expect(c.activeEnvironment()).toBe('dev');
    expect(c.notices.join('\n')).toContain('dev');
  });

  it('does not fall back to the prod org/project/key when the profile lacks them', () => {
    writeFile({ ...both, environments: { dev: { apiUrl: DEV_URL } } });
    const c = make({ GOOD7OB_ENV: 'dev' });
    expect(c.get('apiKey')).toBeFalsy();
    expect(c.get('orgId')).toBeUndefined();
    expect(c.get('projectId')).toBeUndefined();
  });

  it('refuses an environment that is not defined in the config file', () => {
    writeFile(both);
    expect(() => make({ GOOD7OB_ENV: 'test' })).toThrow(/environments\.test\.apiUrl/);
  });

  it('treats empty or "prod" as prod', () => {
    writeFile(both);
    expect(make({ GOOD7OB_ENV: '' }).activeEnvironment()).toBe('prod');
    expect(make({ GOOD7OB_ENV: 'prod' }).get('apiUrl')).toBe(PROD_API_URL);
  });

  it('writes env-scoped values into the active profile and leaves prod untouched', () => {
    writeFile(both);
    make({ GOOD7OB_ENV: 'dev' }).set('projectId', 99);
    const saved = readFile();
    expect(saved.environments.dev.projectId).toBe(99);
    expect(saved.projectId).toBe(10);
  });

  it('will not change the prod URL', () => {
    writeFile(both);
    const c = make();
    expect(() => c.set('apiUrl', DEV_URL)).toThrow(/environments\./);
    expect(() => c.set('apiUrl', PROD_API_URL)).not.toThrow();
  });

  it('defines a profile through setEnvField, but never one called prod', () => {
    writeFile(both);
    const c = make();
    c.setEnvField('test', 'apiUrl', 'https://api-test.good7ob.net');
    c.setEnvField('test', 'orgId', 7);
    expect(readFile().environments.test).toEqual({ apiUrl: 'https://api-test.good7ob.net', orgId: 7 });
    expect(() => c.setEnvField('prod', 'apiUrl', DEV_URL)).toThrow(/prod/);
    expect(() => c.setEnvField('bad name', 'apiUrl', DEV_URL)).toThrow();
  });
});
