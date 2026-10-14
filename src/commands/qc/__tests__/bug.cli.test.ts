/**
 * Tests for `good7ob qc bug create --product-id` (bug.productId 字段).
 */

import { expect, describe, it } from 'vitest';
import { execSync } from 'child_process';

describe('qc bug create', () => {
  const CLI_COMMAND = 'npm run cli --';

  it('lists the optional --product-id option in help', () => {
    const output = execSync(`${CLI_COMMAND} qc bug create --help`).toString();
    expect(output).toContain('--product-id');
  });
});
