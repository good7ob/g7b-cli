import { describe, expect, it, vi } from 'vitest';
import { classify, effectiveOf, sumEffective } from '../effective';

describe('classify', () => {
  it.each([
    ['backend/src/main/java/A.java', 'main'],
    ['front-web/src/views/A.vue', 'main'],
    ['backend/src/test/java/ATest.java', 'test'],
    ['front-web/src/__tests__/a.ts', 'test'],
    ['front-web/e2e/login.ts', 'test'],
    ['front-web/src/a.spec.ts', 'test'],
    ['app/test/a_test.dart', 'test'],
    ['features/login.feature', 'test'],
    ['backend/src/main/resources/db/migration/V1__x.sql', 'sql'],
  ])('%s -> %s', (path, kind) => expect(classify(path)).toBe(kind));

  it.each([
    'README.md', 'docs/api/x.md', 'pom.xml', 'application.yml', 'package.json',
    'front-web/package-lock.json', 'a/node_modules/x/index.js', 'dist/app.js', 'target/classes/A.java',
    'backend/src/main/resources/db/baseline/schema.sql', 'logo.png', 'fonts/a.woff2',
  ])('%s is not effective', (path) => expect(classify(path)).toBe('ignore'));
});

describe('sumEffective', () => {
  it('adds only effective files', () => {
    expect(sumEffective([
      { path: 'A.java', additions: 10, deletions: 2 },
      { path: 'README.md', additions: 100, deletions: 50 },
      { path: 'V9__x.sql', additions: 5, deletions: 0 },
    ])).toEqual({ additions: 15, deletions: 2 });
  });
});

describe('effectiveOf', () => {
  const f = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `A${i}.java`, additions: 1, deletions: 0 }));
  it('uses the listed files when complete, without a REST call', async () => {
    const fetchAll = vi.fn();
    expect(await effectiveOf(f(3), 3, fetchAll)).toEqual({ additions: 3, deletions: 0 });
    expect(fetchAll).not.toHaveBeenCalled();
  });
  it('completes a truncated list through REST', async () => {
    expect(await effectiveOf(f(100), 150, async () => f(150))).toEqual({ additions: 150, deletions: 0 });
  });
  it('is null when REST is also short, or the PR exceeds the REST file limit', async () => {
    expect(await effectiveOf(f(100), 150, async () => f(120))).toBeNull();
    const fetchAll = vi.fn();
    expect(await effectiveOf(f(100), 3000, fetchAll)).toBeNull();
    expect(fetchAll).not.toHaveBeenCalled();
  });
});
