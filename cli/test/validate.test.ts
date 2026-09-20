import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractUrls,
  formatReasons,
  todayStamp,
  validateCard,
  validateCardDetailed,
} from '../src/core/validate.js';
import { normalizeCard, REQUIRED_SECTIONS } from '../src/core/card.js';
import { CARD_DATE_PATTERN } from './date-pattern.js';

const VALID_CARD = `Captured on: 2026-09-19

## Goal
- Ship the CLI

## Key Decisions
- Zero dependencies

## Constraints & Preferences
- Node >= 20

## Current State
- Tests passing

## Resources & Links
- https://example.com/spec

## Open Questions
- None noted.`;

const INPUT = 'Discussion about shipping. See https://example.com/spec for the API spec.';

test('validateCard accepts a card with all required headers in order', () => {
  assert.equal(validateCard(VALID_CARD), true);
});

test('validateCard rejects cards missing any required header', () => {
  for (const h of REQUIRED_SECTIONS.map((s) => `## ${s}`)) {
    const broken = VALID_CARD.split('\n').filter((l) => !l.includes(h)).join('\n');
    assert.equal(validateCard(broken), false, `should fail when ${h} is missing`);
  }
});

test('validateCardDetailed flags out-of-order sections as MISSING_SECTION', () => {
  const swapped = VALID_CARD
    .replace(/\n## Constraints & Preferences[\s\S]*?(?=\n## Current State)/, '')
    .replace('## Current State', '## Constraints & Preferences\n- Node >= 20\n\n## Current State');
  // swapped above loses Resources & Links order — build a clean wrong-order card instead
  const wrongOrder = `Captured on: 2026-09-19

## Goal
- G

## Key Decisions
- D

## Resources & Links
- https://example.com/spec

## Constraints & Preferences
- C

## Current State
- S

## Open Questions
- None noted.`;
  const result = validateCardDetailed(wrongOrder, { input: INPUT, level: 'balanced' });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.code === 'MISSING_SECTION'));
  void swapped;
});

test('validateCardDetailed flags empty sections as EMPTY_SECTION', () => {
  const empty = VALID_CARD.replace('- Ship the CLI\n', '');
  const result = validateCardDetailed(empty, { input: INPUT, level: 'balanced' });
  assert.equal(result.ok, false);
  const emptyProblems = result.problems.filter((p) => p.code === 'EMPTY_SECTION');
  assert.equal(emptyProblems.length, 1);
  assert.match(emptyProblems[0]?.detail ?? '', /Goal/);
});

test('validateCardDetailed accepts "None noted." as content', () => {
  const result = validateCardDetailed(VALID_CARD, { input: INPUT, level: 'balanced' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems.filter((p) => p.code !== 'NO_COMPRESSION'), []);
});

test('FABRICATED_URL: URLs in Resources & Links must appear verbatim in the input', () => {
  const fabricated = VALID_CARD.replace('https://example.com/spec', 'https://example.com/invented');
  const result = validateCardDetailed(fabricated, { input: INPUT, level: 'balanced' });
  assert.equal(result.ok, false);
  const urlProblem = result.problems.find((p) => p.code === 'FABRICATED_URL');
  assert.ok(urlProblem);
  assert.match(urlProblem.detail, /example\.com\/invented/);
});

test('FABRICATED_URL is case-sensitive on the check but tolerant of trailing punctuation', () => {
  const withPunct = VALID_CARD.replace('- https://example.com/spec', '- https://example.com/spec, and more');
  const result = validateCardDetailed(withPunct, { input: INPUT, level: 'balanced' });
  assert.ok(result.problems.every((p) => p.code !== 'FABRICATED_URL'));
});

test('LEVEL_LIMIT: minimal allows at most 2 bullets per section (Resources & Links exempt)', () => {
  const minimal = `Captured on: 2026-09-19

## Goal
- One
- Two

## Key Decisions
- D

## Constraints & Preferences
- C

## Current State
- S

## Resources & Links
- https://example.com/a
- https://example.com/b
- https://example.com/c

## Open Questions
- None noted.`;
  const input = 'a https://example.com/a b https://example.com/b c https://example.com/c';
  const ok = validateCardDetailed(minimal, { input, level: 'minimal' });
  assert.equal(ok.ok, true);

  const threeBullets = minimal.replace('- One\n- Two', '- One\n- Two\n- Three');
  const bad = validateCardDetailed(threeBullets, { input, level: 'minimal' });
  assert.equal(bad.ok, false);
  assert.equal(bad.problems.find((p) => p.code === 'LEVEL_LIMIT')?.code, 'LEVEL_LIMIT');
});

test('NO_COMPRESSION is a warning, not a failure', () => {
  // Genuinely long input — trim-length >= 500 or the check is skipped.
  const longInput = INPUT.repeat(10);
  const bigCard = VALID_CARD + '\n\n' + '- padding '.repeat(150);
  const result = validateCardDetailed(bigCard, { input: longInput, level: 'balanced' });
  assert.equal(result.ok, true);
  assert.ok(result.problems.some((p) => p.code === 'NO_COMPRESSION'));
});

test('NO_COMPRESSION is skipped for very short inputs', () => {
  const result = validateCardDetailed(VALID_CARD, { input: INPUT, level: 'balanced' });
  assert.ok(result.problems.every((p) => p.code !== 'NO_COMPRESSION'));
});

test('formatReasons joins code + detail for the retry prompt', () => {
  const reasons = formatReasons([
    { code: 'MISSING_SECTION', detail: 'missing section "## Goal"' },
    { code: 'LEVEL_LIMIT', detail: '"## Goal" has 3 bullets' },
  ]);
  assert.match(reasons, /^MISSING_SECTION: /);
  assert.match(reasons, /; LEVEL_LIMIT: /);
});

test('todayStamp is ISO YYYY-MM-DD local', () => {
  assert.match(todayStamp(), CARD_DATE_PATTERN);
});

test('normalizeCard strips fences and stamps Captured on exactly once', () => {
  const fenced = '```\n' + VALID_CARD.replace('Captured on: 2026-09-19\n\n', '') + '\n```';
  const out = normalizeCard(fenced);
  assert.equal(out.startsWith('```'), false);
  assert.equal((out.match(/Captured on:/g) || []).length, 1);
  assert.equal(validateCard(out), true);
});

test('extractUrls handles markdown-wrapped and punctuation-suffixed URLs', () => {
  const urls = extractUrls('see https://a.example/x. and <https://b.example/y>, plus https://c.example/z)');
  assert.deepEqual(urls, ['https://a.example/x', 'https://b.example/y', 'https://c.example/z']);
});
