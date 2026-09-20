/**
 * CRLF-regression guard for the prompt parser.
 *
 * Windows CI checks out the repo with core.autocrlf=true, so the shared
 * prompt arrived as CRLF and the hard-coded-LF front-matter regex failed —
 * every Windows job in the matrix failed in seconds while macOS/Ubuntu
 * passed. The parser now normalizes \r\n → \n before parsing; these tests
 * pin that behaviour so it can't regress.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePromptFile } from '../src/core/prompt.js';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
// thisDir = cli/.build/test at runtime → cli/prompts/. npm test regenerates
// cli/prompts/ (sync-prompt) before compiling, so the copy always exists.
const generatedPrompt = path.join(thisDir, '..', '..', 'prompts', 'extraction-prompt.md');

const toCrlf = (text: string): string => text.replace(/\r?\n/g, '\r\n');

test('parsePromptFile parses a CRLF copy identically to the LF canonical', () => {
  const canonical = readFileSync(generatedPrompt, 'utf8');
  const lf = parsePromptFile(canonical);
  const crlf = parsePromptFile(toCrlf(canonical));

  assert.equal(crlf.specVersion, lf.specVersion);
  assert.equal(crlf.blocks.size, lf.blocks.size);
  assert.ok(crlf.blocks.size > 0, 'expected at least one @block');
  for (const [name, body] of lf.blocks) {
    assert.equal(
      crlf.blocks.get(name),
      body,
      `block "${name}" differs after CRLF normalization`
    );
  }
});

test('parsePromptFile still rejects a file without YAML front matter', () => {
  assert.throws(() => parsePromptFile('no front matter\n<!-- @block system -->\n'), /front matter/);
});

test('parsePromptFile still rejects a file with front matter but no @block markers', () => {
  assert.throws(() => parsePromptFile('---\nspec_version: 1\n---\n\nplain text\n'), /@block/);
});
