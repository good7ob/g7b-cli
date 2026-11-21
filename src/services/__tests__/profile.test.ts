import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../ConfigService';
import { dataDir, PROD_API_URL } from '../flavor';
import {
  PROFILE_ENV,
  activeProfile,
  applyProfileArgv,
  normalizeProfile,
  parseEnvFile,
  profileFromArgv,
  readEnvFile,
  writeEnvFile,
} from '../profile';

const PROD = { name: 'prod', apiUrl: PROD_API_URL };
const NET = { name: 'net', apiUrl: 'https://api-dev.good7ob.net' };
const argv = (...a: string[]) => ['node', 'good7ob', ...a];

describe('profile name and argv', () => {
  it('accepts one path segment, rejects traversal and blanks', () => {
    expect(normalizeProfile(' org115-emp41 ')).toBe('org115-emp41');
    expect(normalizeProfile('a.b_c')).toBe('a.b_c');
    for (const bad of ['', '../x', 'a/b', '.hidden', '-x', 'a b', 'x'.repeat(65)]) {
      expect(() => normalizeProfile(bad)).toThrow('--profile');
    }
  });

  it('reads --profile only among the root options', () => {
    expect(profileFromArgv(argv('--profile', 'a', 'agent', 'listen'))).toBe('a');
    expect(profileFromArgv(argv('--profile=b', 'agent', 'listen'))).toBe('b');
    expect(profileFromArgv(argv('agent', 'enroll', 'g7e_x', '--profile', 'c'))).toBeUndefined();
    expect(profileFromArgv(argv('agent', 'listen'))).toBeUndefined();
  });

  it('--profile wins over an inherited GOOD7OB_PROFILE and is exported for child processes', () => {
    const env: NodeJS.ProcessEnv = { [PROFILE_ENV]: 'inherited' };
    expect(applyProfileArgv(argv('--profile', 'flag', 'agent', 'listen'), env)).toBe('flag');
    expect(env[PROFILE_ENV]).toBe('flag');
    expect(applyProfileArgv(argv('agent', 'listen'), { [PROFILE_ENV]: 'inherited' })).toBe('inherited');
    expect(activeProfile({ [PROFILE_ENV]: '' })).toBeUndefined();
    expect(() => applyProfileArgv(argv('--profile', '../etc', 'whoami'), {})).toThrow('--profile');
  });
});

describe('dataDir: one root for every local file', () => {
  it('a profile lives in ~/.good7ob-profiles/<name>, whatever the flavor', () => {
    expect(dataDir(PROD, '/h', 'a')).toBe(path.join('/h', '.good7ob-profiles', 'a'));
    expect(dataDir(NET, '/h', 'a')).toBe(path.join('/h', '.good7ob-profiles', 'a'));
  });

  it('without a profile nothing changes, including the net flavor', () => {
    expect(dataDir(PROD, '/h', null)).toBe(path.join('/h', '.good7ob'));
    expect(dataDir(NET, '/h', null)).toBe(path.join('/h', '.good7ob-net'));
  });

  it('follows GOOD7OB_PROFILE by default', () => {
    const before = process.env[PROFILE_ENV];
    try {
      process.env[PROFILE_ENV] = 'p1';
      expect(dataDir(NET, '/h')).toBe(path.join('/h', '.good7ob-profiles', 'p1'));
      delete process.env[PROFILE_ENV];
      expect(dataDir(NET, '/h')).toBe(path.join('/h', '.good7ob-net'));
    } finally {
      if (before === undefined) delete process.env[PROFILE_ENV];
      else process.env[PROFILE_ENV] = before;
    }
  });
});

describe('ConfigService with a profile', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-prof-'));
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('keeps its own apiUrl and key next to the default config, which stays fixed to the flavor', () => {
    const p = new ConfigService({ homeDir: home, flavor: NET, profile: 'org1-emp2' });
    expect(p.get('apiUrl')).toBe(NET.apiUrl);
    p.update({ apiUrl: 'https://api.example.com/', apiKey: 'k-profile' });
    expect(p.notices).toEqual([`[good7ob] 使用配置档 org1-emp2：${NET.apiUrl}`]);

    const again = new ConfigService({ homeDir: home, flavor: NET, profile: 'org1-emp2' });
    expect(again.get('apiUrl')).toBe('https://api.example.com');
    expect(again.get('apiKey')).toBe('k-profile');
    expect(again.profileName()).toBe('org1-emp2');
    expect(fs.statSync(path.join(home, '.good7ob-profiles', 'org1-emp2', 'config.json')).mode & 0o777).toBe(0o600);
    expect(() => again.set('apiUrl', 'ftp://x')).toThrow('http(s)');

    const plain = new ConfigService({ homeDir: home, flavor: NET, profile: null });
    expect(plain.get('apiKey')).toBe('');
    expect(plain.get('apiUrl')).toBe(NET.apiUrl);
    expect(() => plain.set('apiUrl', 'https://api.example.com')).toThrow('不能修改');
    expect(fs.existsSync(path.join(home, '.good7ob-net', 'config.json'))).toBe(false);
  });
});

describe('profile env file', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g7b-env-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('is written with mode 600, merged with what is already there', () => {
    writeEnvFile(dir, { CLAUDE_CODE_OAUTH_TOKEN: 'tok' });
    writeEnvFile(dir, { ANTHROPIC_API_KEY: 'sk-1' });
    const file = path.join(dir, 'env');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(readEnvFile(dir)).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'tok', ANTHROPIC_API_KEY: 'sk-1' });
  });

  it('a pre-existing world-readable file is tightened to 600', () => {
    fs.writeFileSync(path.join(dir, 'env'), 'A=1\n', { mode: 0o644 });
    writeEnvFile(dir, { B: '2' });
    expect(fs.statSync(path.join(dir, 'env')).mode & 0o777).toBe(0o600);
  });

  it('refuses names and values that would break the file', () => {
    expect(() => writeEnvFile(dir, { 'A-B': 'x' })).toThrow('A-B');
    expect(() => writeEnvFile(dir, { A: 'x\nB=y' })).toThrow('换行');
  });

  it('parses KEY=value, quotes, export and comments', () => {
    expect(parseEnvFile('# c\nexport A=1\nB="two words"\nC=\'3\'\nbad line\n=x\n')).toEqual({ A: '1', B: 'two words', C: '3' });
  });
});
