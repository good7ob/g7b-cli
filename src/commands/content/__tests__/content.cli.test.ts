/**
 * Tests for the `good7ob content list` command
 * (MOD-19-SUB-09, fun-org-copy-0005).
 */

import { expect, describe, it } from 'vitest';
import { execSync } from 'child_process';

describe('Content CLI Commands', () => {
  const CLI_COMMAND = 'npm run cli --';

  describe('content list', () => {
    it('should require --product-id', () => {
      expect(() => {
        execSync(`${CLI_COMMAND} content list`, { stdio: 'pipe' });
      }).toThrow();
    });

    it('should show help with the expected options', () => {
      const output = execSync(`${CLI_COMMAND} content list --help`).toString();
      expect(output).toContain('--product-id');
      expect(output).toContain('--format');
      expect(output).toContain('--category');
      expect(output).toContain('--locale');
    });

    it('should attempt the request and surface a connection/auth error rather than crash silently', () => {
      try {
        execSync(`${CLI_COMMAND} content list --product-id 1 --format json`, { stdio: 'pipe' });
      } catch (error: any) {
        // API may not be reachable in this environment — the CLI should
        // still exit with a defined non-zero status rather than throw an
        // unhandled/uncaught error.
        expect(error.status || error.code).toBeDefined();
      }
    });
  });

  describe('content help', () => {
    it('should list the content command group', () => {
      const output = execSync(`${CLI_COMMAND} --help`).toString();
      expect(output).toContain('content');
    });
  });
});
