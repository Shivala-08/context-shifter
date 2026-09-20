import test from 'node:test';
import assert from 'node:assert/strict';

import { buildJsonOutput, serializeJsonOutput } from '../src/core/jsonout.js';
import { cardSpecVersion } from '../src/core/prompt.js';
import { estimateTokens } from '../src/core/tokens.js';
import type { PipelineResult } from '../src/core/pipeline.js';
import { VERSION } from '../src/version.js';
import { VALID_CARD } from './helpers.js';

const BASE_RESULT: PipelineResult = {
  card: VALID_CARD,
  valid: true,
  problems: [],
  warnings: [],
  statsLine: '100 → 50 tokens · 50% smaller',
  originalTokens: 100,
  usage: { inputTokens: 40, outputTokens: 50 },
  chunked: false,
  chunks: 1,
  version: VERSION,
};

const META = { backend: 'ollama' as const, model: 'qwen3:8b', level: 'balanced' as const };

test('--json exposes spec_version, cli_version, backend, model and level', () => {
  const out = buildJsonOutput(BASE_RESULT, META);
  assert.equal(out.spec_version, cardSpecVersion());
  assert.equal(out.cli_version, VERSION);
  assert.equal(out.backend, 'ollama');
  assert.equal(out.model, 'qwen3:8b');
  assert.equal(out.level, 'balanced');
});

test('--json splits sections into trimmed line arrays (PRD: sections as arrays)', () => {
  const out = buildJsonOutput(BASE_RESULT, META);
  assert.deepEqual(out.sections['Goal'], ['- Ship the CLI']);
  assert.deepEqual(out.sections['Resources & Links'], ['- https://example.com/spec']);
  assert.deepEqual(out.sections['Open Questions'], ['- None noted.']);
  // Every spec section appears; unknown sections never leak in.
  assert.equal(Object.keys(out.sections).length, 6);
});

test('--json prefers real API usage for card token counts', () => {
  const out = buildJsonOutput(BASE_RESULT, META);
  assert.equal(out.stats.original_tokens, 100);
  assert.equal(out.stats.card_tokens, 50);
  assert.equal(out.stats.reduction_percent, 50);
  assert.equal(out.stats.summary, BASE_RESULT.statsLine);
});

test('--json falls back to the chars/4 estimate when usage is absent', () => {
  const noUsage = { ...BASE_RESULT, usage: undefined };
  const out = buildJsonOutput(noUsage, META);
  assert.equal(out.stats.card_tokens, estimateTokens(VALID_CARD));
  assert.equal(out.stats.original_tokens, 100);
});

test('--json carries validity, problems and warnings', () => {
  const failing: PipelineResult = {
    ...BASE_RESULT,
    valid: false,
    problems: [{ code: 'MISSING_SECTION', detail: 'missing ## Goal' }],
    warnings: ['review before using'],
  };
  const out = buildJsonOutput(failing, META);
  assert.equal(out.valid, false);
  assert.deepEqual(out.problems, [{ code: 'MISSING_SECTION', detail: 'missing ## Goal' }]);
  assert.deepEqual(out.warnings, ['review before using']);
});

test('--json includes captured_on from the card stamp and a full captured_at timestamp', () => {
  const out = buildJsonOutput(BASE_RESULT, META);
  assert.equal(out.captured_on, '2026-09-19');
  assert.ok(!Number.isNaN(Date.parse(out.captured_at)));
});

test('--json includes redaction info only when --redact ran', () => {
  const without = buildJsonOutput(BASE_RESULT, META);
  assert.equal(without.redacted, undefined);
  const withRedaction = buildJsonOutput(BASE_RESULT, {
    ...META,
    redaction: { applied: true, matches: [{ type: 'jwt', count: 1 }] },
  });
  assert.deepEqual(withRedaction.redacted, { applied: true, matches: [{ type: 'jwt', count: 1 }] });
});

test('serializeJsonOutput is stable, pretty-printed and newline-terminated', () => {
  const text = serializeJsonOutput(buildJsonOutput(BASE_RESULT, META));
  assert.ok(text.endsWith('\n'));
  const reparsed = JSON.parse(text) as { spec_version: number };
  assert.equal(reparsed.spec_version, cardSpecVersion());
  assert.ok(text.includes('\n  "spec_version"'));
});
