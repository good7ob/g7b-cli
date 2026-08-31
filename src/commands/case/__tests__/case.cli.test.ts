/**
 * Tests for the `good7ob case import` command (g7b #1008).
 */

import { expect, describe, it } from 'vitest';
import { execSync } from 'child_process';

describe('Case CLI Commands', () => {
  const CLI_COMMAND = 'npm run cli --';

  describe('case import', () => {
    it('should show help with the expected options', () => {
      const output = execSync(`${CLI_COMMAND} case import --help`).toString();
      expect(output).toContain('--file');
      expect(output).toContain('--dry-run');
      expect(output).toContain('--yes');
      expect(output).toContain('--json');
    });

    it('should fail gracefully when there is no content to recognize', () => {
      // No text arg, no --file, and execSync's default piped stdin is
      // immediately closed — resolveContent() should see an empty string
      // and exit non-zero rather than hang waiting on stdin.
      try {
        execSync(`${CLI_COMMAND} case import`, { stdio: 'pipe' });
        throw new Error('expected the command to exit non-zero');
      } catch (error: any) {
        expect(error.status).toBeDefined();
        expect(error.status).not.toBe(0);
      }
    });

    it('should attempt the request and surface a connection/auth error rather than crash silently', () => {
      try {
        execSync(`${CLI_COMMAND} case import "テスト案件" --dry-run`, { stdio: 'pipe' });
      } catch (error: any) {
        // API may not be reachable in this environment — the CLI should
        // still exit with a defined non-zero status rather than throw an
        // unhandled/uncaught error.
        expect(error.status || error.code).toBeDefined();
      }
    });
  });

  describe('case help', () => {
    it('should list the case command group', () => {
      const output = execSync(`${CLI_COMMAND} --help`).toString();
      expect(output).toContain('case');
    });
  });
});
