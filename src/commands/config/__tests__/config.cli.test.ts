import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../../../../');
const cliPath = path.join(repoRoot, 'dist', 'index.js');

function runCli(args: string[], homeDir: string) {
  return execFileSync('node', [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, HOME: homeDir },
    encoding: 'utf-8',
  });
}

describe('Config CLI Commands', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
  });

  afterEach(() => {
    fs.rmSync(path.join(os.tmpdir(), 'good7ob-cli-test-home'), { recursive: true, force: true });
  });

  it('sets and gets api-key via the config command', () => {
    const homeDir = path.join(os.tmpdir(), 'good7ob-cli-test-home');
    fs.mkdirSync(homeDir, { recursive: true });

    const setOutput = runCli(['config', 'set', 'api-key', 'g7b_sk_test_value_1234'], homeDir);
    expect(setOutput).toContain('✓ Config updated: apiKey = g7b_...1234');

    const getOutput = runCli(['config', 'get', 'api-key'], homeDir);
    expect(getOutput).toContain('apiKey=g7b_...1234');

    const configPath = path.join(homeDir, '.good7ob', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(config.apiKey).toBe('g7b_sk_test_value_1234');
  });

  it('lists config values without exposing the full api key', () => {
    const homeDir = path.join(os.tmpdir(), 'good7ob-cli-test-home');
    fs.mkdirSync(homeDir, { recursive: true });

    runCli(['config', 'set', 'api-key', 'g7b_sk_test_value_5678'], homeDir);
    const listOutput = runCli(['config', 'list'], homeDir);

    expect(listOutput).toContain('apiKey: g7b_...5678');
    expect(listOutput).not.toContain('g7b_sk_test_value_5678');
  });
});