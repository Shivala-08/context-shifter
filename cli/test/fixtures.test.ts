import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateCardDetailed } from '../src/core/validate.js';
import { findPackageRoot } from '../src/version.js';
import type { Level } from '../src/core/prompt.js';

// Walk up from .build/test (or test/) to the package root, then to ../shared.
const FIXTURES = path.join(findPackageRoot(path.dirname(fileURLToPath(import.meta.url))), '..', 'shared', 'fixtures');

interface FixtureMeta {
  input: string;
  level: Level;
  reason?: string;
}

/** Parses the fixtures' simple `key: value` front matter. */
function frontMatter(card: string): { meta: FixtureMeta; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n\n?/.exec(card);
  assert.ok(m, 'fixture front matter is required');
  const meta: Record<string, string> = {};
  for (const line of (m[1] ?? '').split('\n')) {
    const kv = /^(\w+):\s*(.+)$/.exec(line);
    if (kv?.[1] !== undefined && kv[2] !== undefined) meta[kv[1]] = kv[2].trim();
  }
  assert.ok(meta.input, 'fixture front matter must name its input transcript');
  assert.ok(meta.level, 'fixture front matter must name its level');
  return {
    meta: { input: meta.input ?? '', level: meta.level as Level, reason: meta.reason },
    body: card.slice(m[0].length).trimEnd(),
  };
}

function transcript(rel: string): string {
  return fs.readFileSync(path.join(FIXTURES, rel), 'utf8');
}

function fixtureFiles(dir: string): string[] {
  return fs.readdirSync(path.join(FIXTURES, dir)).filter((f) => f.endsWith('.md'));
}

test('every shared cards-valid fixture passes validation', () => {
  const files = fixtureFiles('cards-valid');
  assert.ok(files.length >= 2, 'expected the shared valid fixtures to exist');
  for (const file of files) {
    const card = fs.readFileSync(path.join(FIXTURES, 'cards-valid', file), 'utf8');
    const { meta, body } = frontMatter(card);
    const result = validateCardDetailed(body, { input: transcript(meta.input), level: meta.level });
    assert.deepEqual(
      result.problems.filter((p) => p.code !== 'NO_COMPRESSION'),
      [],
      `${file} should pass validation`
    );
    assert.equal(result.ok, true, `${file} should validate`);
  }
});

test('every shared cards-invalid fixture fails with its declared reason code', () => {
  const files = fixtureFiles('cards-invalid');
  assert.ok(files.length >= 4, 'expected the shared invalid fixtures to exist');
  for (const file of files) {
    const card = fs.readFileSync(path.join(FIXTURES, 'cards-invalid', file), 'utf8');
    const { meta, body } = frontMatter(card);
    assert.ok(meta.reason, `${file} must declare its expected reason code`);
    const result = validateCardDetailed(body, { input: transcript(meta.input), level: meta.level });
    assert.equal(result.ok, false, `${file} should fail validation`);
    const codes = result.problems.map((p) => p.code);
    assert.ok(
      codes.includes(meta.reason as never),
      `${file} should fail with ${meta.reason}, got [${codes.join(', ')}]`
    );
  }
});
