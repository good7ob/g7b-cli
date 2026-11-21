/**
 * Side-effect module, imported first by index.ts: turns the global `--profile <name>` into GOOD7OB_PROFILE before
 * ConfigService / ApiClient build their shared instances (see profile.ts).
 */

import { applyProfileArgv } from './profile';

try {
  applyProfileArgv(process.argv, process.env);
} catch (error) {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
