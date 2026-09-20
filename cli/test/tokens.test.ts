import test from 'node:test';
import assert from 'node:assert/strict';

import { compactTokenCount, estimateTokens, reductionSummary } from '../src/core/tokens.js';

test('estimateTokens uses the ~4 chars/token heuristic', () => {
  assert.equal(estimateTokens('x'.repeat(8)), 2);
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abc'), 0); // floor(3/4)
});

test('compactTokenCount formats 18.4k style', () => {
  assert.equal(compactTokenCount(18400), '18.4k');
  assert.equal(compactTokenCount(1000), '1.0k');
  assert.equal(compactTokenCount(999), '999');
  assert.equal(compactTokenCount(0), '0');
});

test('reductionSummary builds the "18.4k → 2.1k tokens · 89% smaller" line', () => {
  const original = 'x'.repeat(18400); // 4600 tokens
  const line = reductionSummary(original, 'card', { outputTokens: 500 });
  assert.equal(line, '4.6k → 500 tokens · 89% smaller');
});

test('reductionSummary falls back to chars/4 when no usage is reported', () => {
  const original = 'x'.repeat(4000); // 1000 tokens
  const card = 'y'.repeat(800); // 200 tokens
  assert.equal(reductionSummary(original, card), '1.0k → 200 tokens · 80% smaller');
});

test('reductionSummary reports no reduction honestly', () => {
  const original = 'x'.repeat(4000);
  const card = 'y'.repeat(4000);
  const line = reductionSummary(original, card);
  assert.match(line, /\(no reduction\)/);
});

test('reductionSummary is empty for degenerate inputs', () => {
  assert.equal(reductionSummary('', 'card'), '');
  assert.equal(reductionSummary('ab', 'card'), '');
});
