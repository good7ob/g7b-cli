/**
 * On-disk layout of `good7ob cache`: `~/.good7ob/cache/<identity>-org<N>/product-<id>/`.
 *
 * One directory per identity + organization + product, so switching account never serves another
 * identity's content. A section (prd / design / ui / tasks) is written to a temp directory and swapped
 * in with a rename, so a crash or a failed pull never leaves a half-written section behind.
 * Local only: nothing here is ever sent back to the platform.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface SectionMeta {
  count: number;
  pulledAt: string;
  /** item id -> platform `updatedAt`, used to skip unchanged items on the next pull */
  stamps: Record<string, string>;
}

export interface Manifest {
  productId: number;
  orgId: number;
  pulledAt: string;
  sections: Record<string, SectionMeta>;
  errors: Record<string, string>;
}

/** File name made of platform-supplied text: separators and anything odd become `_`, so it cannot leave its directory. */
export const safeName = (raw: string): string => raw.replace(/[^A-Za-z0-9._-]/g, '_');

export class CacheStore {
  readonly dir: string;

  constructor(identityKey: string, productId: number) {
    if (!/^[a-z]+-[0-9]+-org[0-9]+$/.test(identityKey)) throw new Error(`非法的缓存键: ${identityKey}`);
    this.dir = path.join(os.homedir(), '.good7ob', 'cache', identityKey, `product-${productId}`);
  }

  readManifest(): Manifest | null {
    const file = path.join(this.dir, 'manifest.json');
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as Manifest;
    } catch (e) {
      throw new Error(`缓存清单已损坏: ${file}（删除该目录后重新 cache pull）`);
    }
  }

  writeManifest(manifest: Manifest): void {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(this.dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  }

  /** Content of an earlier pull, or null when it is not there (a stamp match only counts if the file survived). */
  readFile(section: string, name: string): string | null {
    const file = path.join(this.dir, section, name);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
  }

  /** Replace a whole section; `files` keys are names inside the section directory. */
  writeSection(section: string, files: Record<string, string>): void {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(this.dir, `.${section}.tmp-${process.pid}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { mode: 0o700 });
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(tmp, name), content, { mode: 0o600 });
    const final = path.join(this.dir, section);
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(tmp, final);
  }
}
