import { describe, expect, it } from 'vitest';
import { execSync } from 'child_process';

describe('kb CLI commands', () => {
  const CLI = 'npm run cli --';

  it('lists ls/search/chat under kb', () => {
    const out = execSync(`${CLI} kb --help`).toString();
    ['ls', 'search', 'chat'].forEach((c) => expect(out).toContain(c));
  });

  it('requires a query for search and a message for chat', () => {
    expect(() => execSync(`${CLI} kb search`, { stdio: 'pipe' })).toThrow();
    expect(() => execSync(`${CLI} kb chat`, { stdio: 'pipe' })).toThrow();
  });

  it('rejects an unknown --source before calling the API', () => {
    expect(() => execSync(`${CLI} kb ls --source foo`, { stdio: 'pipe' })).toThrow(/--source must be one of/);
  });
});
