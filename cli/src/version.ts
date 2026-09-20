/**
 * Reads the package version without import-attributes (their syntax varies
 * across Node 20–24 lines). Locates package.json by walking up from the
 * compiled file, so it works from dist/, .build/ and src/ alike.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walks up from `startDir` until a package.json is found. */
export function findPackageRoot(startDir: string): string {
  let dir = startDir;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`package.json not found above ${startDir}.`);
    }
    dir = parent;
  }
}

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = findPackageRoot(thisDir);

const require = createRequire(import.meta.url);
const pkg = require(path.join(packageRoot, 'package.json')) as { version: string };

export const VERSION: string = pkg.version;
