/**
 * Tests for `good7ob qc bug create --product-id` (bug.productId 字段).
 */

import { expect, describe, it } from 'vitest';
import { execSync } from 'child_process';
import { buildBugUpdateBody } from '../bug';

describe('qc bug create', () => {
  const CLI_COMMAND = 'npm run cli --';

  it('lists the optional --product-id option in help', () => {
    const output = execSync(`${CLI_COMMAND} qc bug create --help`).toString();
    expect(output).toContain('--product-id');
  });
});

describe('qc bug update', () => {
  it('lists --product-id in help', () => {
    const output = execSync('npm run cli -- qc bug update --help').toString();
    expect(output).toContain('--product-id');
  });

  it('builds a body with only the given fields', () => {
    expect(buildBugUpdateBody({ productId: '10' })).toEqual({ productId: 10 });
    expect(buildBugUpdateBody({ module: 'm', severity: 'minor' })).toEqual({
      moduleName: 'm',
      severity: 'minor',
    });
    expect(buildBugUpdateBody({})).toEqual({});
  });
});
