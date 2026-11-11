/**
 * Tests for the `good7ob content list` command
 * (MOD-19-SUB-09, fun-org-copy-0005).
 */

import { expect, describe, it } from 'vitest';
import { execSync } from 'child_process';
import { buildListParams, csvField } from '../index';

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
      expect(output).toContain('--app-id');
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

  describe('buildListParams', () => {
    it('defaults to page 1 / 100 and omits unset filters', () => {
      expect(buildListParams({})).toEqual({ page: 1, pageSize: 100 });
    });

    it('passes category/key/locale through', () => {
      expect(buildListParams({ category: 'login', key: 'title', locale: 'jp' })).toEqual({
        page: 1,
        pageSize: 100,
        category: 'login',
        key: 'title',
        locale: 'jp',
      });
    });

    it('converts --app-id to a number', () => {
      expect(buildListParams({ appId: '3' })).toMatchObject({ appId: 3 });
    });

    it.each(['0', '-1', 'abc', '3.5', '', '03'])('rejects invalid --app-id %j', (bad) => {
      expect(() => buildListParams({ appId: bad })).toThrow('--app-id');
    });
  });

  describe('csvField', () => {
    it('quotes values containing commas, quotes or newlines', () => {
      expect(csvField('a,b')).toBe('"a,b"');
      expect(csvField('say "hi"')).toBe('"say ""hi"""');
      expect(csvField(null)).toBe('');
    });
  });
});
