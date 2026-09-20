#!/usr/bin/env node
/**
 * Runs the compiled test files (.build/test/*.test.js) with an explicit file
 * list. `node --test <dir>` misbehaves on some Node lines (25) and glob
 * entry-point args need Node >= 21, so enumerating files keeps `npm test`
 * working identically on Node 20 through 25 (CI matrix: 20/22/24).
 */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const dir = '.build/test';

let files;
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => join(dir, f));
} catch {
  console.error(`run-tests: ${dir} not found — run \`tsc -p tsconfig.test.json\` first.`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`run-tests: no *.test.js files found in ${dir}.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
