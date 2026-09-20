#!/usr/bin/env node
/**
 * sync-prompt.mjs — generate the CLI's copy of the canonical extraction prompt.
 *
 * Copies shared/extraction-prompt.md (repo root) to cli/prompts/, and writes
 * cli/prompts/manifest.json with { spec_version, sha256 }. The generated copy
 * is git-ignored but shipped in the npm tarball ("files" includes "prompts").
 *
 *     node scripts/sync-prompt.mjs           # regenerate cli/prompts/
 *     node scripts/sync-prompt.mjs --check   # verify the copy matches shared/
 *
 * --check is idempotent: if cli/prompts/ is missing it regenerates it, then
 * verifies byte-identity and spec_version consistency. CI runs it as the
 * shared-drift guard (TRD §5.3). Fails with exit 1 if shared/ is missing,
 * unparseable, or the on-disk copy drifted.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED_PROMPT = path.resolve(CLI_DIR, '..', 'shared', 'extraction-prompt.md');
const OUT_DIR = path.join(CLI_DIR, 'prompts');
const OUT_PROMPT = path.join(OUT_DIR, 'extraction-prompt.md');
const OUT_MANIFEST = path.join(OUT_DIR, 'manifest.json');

/** Reads shared/extraction-prompt.md and returns { specVersion, sha256, bytes }. */
function readCanonical() {
  let bytes;
  try {
    bytes = fs.readFileSync(SHARED_PROMPT);
  } catch {
    fail(`shared/extraction-prompt.md not found at ${SHARED_PROMPT} — the CLI cannot be built without the canonical prompt.`);
  }

  const text = bytes.toString('utf8');
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!fm) fail('shared/extraction-prompt.md has no YAML front matter (expected ---\\nspec_version: 1\\n---).');

  const specMatch = /^spec_version:\s*(\d+)\s*$/m.exec(fm[1]);
  if (!specMatch) fail('shared/extraction-prompt.md front matter is missing "spec_version: <int>".');

  for (const block of ['system', 'level:full', 'level:balanced', 'level:minimal', 'merge', 'retry']) {
    if (!text.includes(`<!-- @block ${block} -->`)) {
      fail(`shared/extraction-prompt.md is missing the "@block ${block}" marker.`);
    }
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { specVersion: Number(specMatch[1]), sha256, bytes };
}

function fail(message) {
  console.error('sync-prompt: ' + message);
  process.exit(1);
}

function generate() {
  const { specVersion, sha256, bytes } = readCanonical();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PROMPT, bytes);
  fs.writeFileSync(
    OUT_MANIFEST,
    JSON.stringify({ spec_version: specVersion, sha256, source: 'shared/extraction-prompt.md' }, null, 2) + '\n'
  );
  return { specVersion, sha256 };
}

const check = process.argv.includes('--check');

if (check) {
  const { specVersion, sha256 } = readCanonical();
  let onDisk;
  try {
    onDisk = fs.readFileSync(OUT_PROMPT);
  } catch {
    // Missing generated copy (fresh clone) — regenerate, then verify below.
    generate();
    onDisk = fs.readFileSync(OUT_PROMPT);
  }
  const diskHash = createHash('sha256').update(onDisk).digest('hex');
  if (diskHash !== sha256) {
    fail(`cli/prompts/extraction-prompt.md drifted from shared/extraction-prompt.md (sha256 ${diskHash.slice(0, 12)}… != ${sha256.slice(0, 12)}…). Run \`npm run sync-prompt\`.`);
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(OUT_MANIFEST, 'utf8'));
    if (manifest.spec_version !== specVersion || manifest.sha256 !== sha256) {
      fail('cli/prompts/manifest.json is out of date — run `npm run sync-prompt`.');
    }
  } catch {
    fail('cli/prompts/manifest.json is missing or unreadable — run `npm run sync-prompt`.');
  }
  console.log(`OK: cli/prompts/ matches shared/extraction-prompt.md (spec_version ${specVersion}, sha256 ${sha256.slice(0, 12)}…).`);
} else {
  const { specVersion, sha256 } = generate();
  console.log(`Synced cli/prompts/ from shared/extraction-prompt.md (spec_version ${specVersion}, sha256 ${sha256.slice(0, 12)}…).`);
}
