/**
 * Which backend this install talks to.
 *
 * A release install is production: fixed address, data in ~/.good7ob. A dev clone opts in by a `dev-env.json` next
 * to package.json (not shipped in the npm package, see package.json "files"), e.g.
 *   { "name": "dev", "apiUrl": "https://api-dev.good7ob.net" }
 * and then keeps its config and local state in ~/.good7ob-dev, so two installs on one machine never share a key,
 * an org or a work slot.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const PROD_API_URL = 'https://api.good7ob.com';
export const PROD = 'prod';
export const FLAVOR_FILE = 'dev-env.json';
const NAME = /^[a-z][a-z0-9-]{0,31}$/;

export interface Flavor {
  name: string;
  apiUrl: string;
}

/** Reads the flavor of the install rooted at `root`; throws a readable error for a broken file. */
export function loadFlavor(root: string = path.resolve(__dirname, '..', '..')): Flavor {
  const file = path.join(root, FLAVOR_FILE);
  if (!fs.existsSync(file)) {
    return { name: PROD, apiUrl: PROD_API_URL };
  }
  let raw: { name?: unknown; apiUrl?: unknown };
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    throw new Error(`${file} 不是合法的 JSON`);
  }
  if (typeof raw.name !== 'string' || !NAME.test(raw.name) || raw.name === PROD) {
    throw new Error(`${file}：name 要用小写字母、数字和连字符，以字母开头，且不能是 ${PROD}`);
  }
  if (typeof raw.apiUrl !== 'string' || !/^https?:\/\/\S+$/.test(raw.apiUrl)) {
    throw new Error(`${file}：apiUrl 必须是 http(s) 地址`);
  }
  return { name: raw.name, apiUrl: raw.apiUrl.replace(/\/+$/, '') };
}

/** Resolved on every call so a changed HOME is honoured (tests). */
export function dataDir(flavor: Flavor = currentFlavor, home: string = os.homedir()): string {
  return path.join(home, flavor.name === PROD ? '.good7ob' : `.good7ob-${flavor.name}`);
}

function readCurrent(): Flavor {
  try {
    return loadFlavor();
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export const currentFlavor: Flavor = readCurrent();
