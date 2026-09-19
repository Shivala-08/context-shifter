'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REQUIRED_HEADERS,
  validateCard,
  normalizeCard,
  extractValidated,
  stripThinkBlocks,
  todayStamp,
  CARD_DATE_PATTERN,
} = require('../src/validate');

const VALID_CARD = `Captured on: 2026-09-19

## Goal
- Ship the CLI

## Key Decisions
- Zero dependencies

## Constraints & Preferences
- Node >= 18

## Current State
- Tests passing

## Resources & Links
- https://example.com/spec

## Open Questions
- None noted.`;

test('validateCard accepts a card with all required headers', () => {
  assert.equal(validateCard(VALID_CARD), true);
});

test('validateCard rejects cards missing any required header', () => {
  for (const missing of REQUIRED_HEADERS) {
    const broken = VALID_CARD
      .split('\n')
      .filter((line) => !line.includes(missing))
      .join('\n');
    assert.equal(validateCard(broken), false, `should fail when ${missing} is missing`);
  }
});

test('normalizeCard stamps Captured on when the model dropped it', () => {
  const stamped = normalizeCard('## Goal\n- Ship the CLI');
  assert.match(stamped, /^Captured on: \d{4}-\d{2}-\d{2}\n\n## Goal/);
  assert.match(todayStamp(), CARD_DATE_PATTERN);
});

test('normalizeCard never double-stamps', () => {
  const twice = normalizeCard(VALID_CARD);
  assert.equal((twice.match(/Captured on:/g) || []).length, 1);
});

test('normalizeCard strips a leading markdown fence', () => {
  const fenced = '```\n' + VALID_CARD + '\n```';
  const normalized = normalizeCard(fenced);
  assert.equal(normalized.startsWith('```'), false);
  assert.equal(validateCard(normalized), true);
});

test('normalizeCard leaves interior code fences alone', () => {
  const interior = `Captured on: 2026-09-19

## Goal
Run:
\`\`\`bash
npm test
\`\`\`

## Key Decisions
- None noted.

## Constraints & Preferences
- None noted.

## Current State
- None noted.

## Resources & Links
- None noted.

## Open Questions
- None noted.`;
  assert.equal(normalizeCard(interior), interior);
});

test('stripThinkBlocks removes qwen3 reasoning blocks', () => {
  const dirty = '<think>hmm let me reason</think>\n\n## Goal\n- Ship it';
  assert.equal(stripThinkBlocks(dirty), '## Goal\n- Ship it');
});

test('extractValidated returns a valid first pass without retry', async () => {
  const calls = [];
  const rawCall = async (input, opts = {}) => {
    calls.push({ input, strict: !!opts.strict });
    return VALID_CARD;
  };
  const { card, needsFormatWarning } = await extractValidated(rawCall, 'conv');
  assert.equal(needsFormatWarning, false);
  assert.equal(card, VALID_CARD);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].strict, false);
});

test('extractValidated retries once with strict flag when malformed', async () => {
  const calls = [];
  const rawCall = async (input, opts = {}) => {
    calls.push({ strict: !!opts.strict });
    return calls.length === 1 ? 'garbage preamble, no headers' : VALID_CARD;
  };
  const { card, needsFormatWarning } = await extractValidated(rawCall, 'conv');
  assert.equal(needsFormatWarning, false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((c) => c.strict), [false, true]);
  assert.equal(validateCard(card), true);
});

test('extractValidated flags a warning when retry is also malformed', async () => {
  const rawCall = async () => 'still no headers';
  const { card, needsFormatWarning } = await extractValidated(rawCall, 'conv');
  assert.equal(needsFormatWarning, true);
  assert.equal(validateCard(card), false);
});
