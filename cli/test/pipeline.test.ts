import test from 'node:test';
import assert from 'node:assert/strict';

import { runExtraction } from '../src/core/pipeline.js';
import { EXIT } from '../src/core/errors.js';
import { assertOfflineAllowed } from '../src/commands/extract.js';
import { fakeBackend, VALID_INPUT } from './helpers.js';
import { createOllamaBackend } from '../src/backends/ollama.js';
import { createAnthropicBackend } from '../src/backends/anthropic.js';
import { createNimBackend } from '../src/backends/nim.js';

const PROGRESS: string[] = [];
const onProgress = (line: string) => PROGRESS.push(line);

test('short input makes a single call and passes validation', async () => {
  const backend = fakeBackend();
  const result = await runExtraction({ input: VALID_INPUT, level: 'balanced', backend });
  assert.equal(backend.calls.length, 1);
  assert.equal(result.valid, true);
  assert.equal(result.chunked, false);
  assert.equal(result.chunks, 1);
  assert.ok(result.card.startsWith('Captured on: '));
  assert.match(result.statsLine, /→/);
});

test('map call labels the part and uses the full level', async () => {
  const backend = fakeBackend();
  await runExtraction({ input: VALID_INPUT, level: 'minimal', backend });
  const req = backend.calls[0];
  assert.ok(req, 'expected one call');
  assert.match(req.system, /minimal/i);
  assert.match(req.user, /Here is the conversation to extract from:/);
  assert.ok(req.user.includes(VALID_INPUT));
});

test('oversized input is chunked, merged, and validated once at the end', async () => {
  const turns: string[] = [];
  for (let i = 0; i < 12; i++) {
    turns.push(`${i % 2 === 0 ? 'user' : 'assistant'}: turn ${i} — ${'detail '.repeat(30)}`);
  }
  const input = turns.join('\n\n') + ' ' + VALID_INPUT;
  const backend = fakeBackend({ contextWindowTokens: 2000 }); // budget clamps to 200
  const result = await runExtraction({ input, level: 'balanced', backend, onProgress });

  assert.equal(result.chunked, true);
  assert.ok(result.chunks > 1);
  // Map calls label parts chronologically…
  assert.match(backend.calls[0]?.system ?? '', /part 1 of \d+/);
  // …and a merge call combines the partial cards.
  const mergeCalls = backend.calls.filter((c) => /Merge the following \d+ partial/.test(c.user));
  assert.ok(mergeCalls.length >= 1, 'expected at least one merge call');
  const finalCall = backend.calls[backend.calls.length - 1];
  assert.ok(finalCall, 'expected a final merge call');
  assert.match(finalCall?.system ?? '', /merge/i);
  assert.equal(result.valid, true);
  assert.match(PROGRESS.join('\n'), /chunk 1\/\d+/);
});

test('validation failure retries once with the reason codes at temperature 0', async () => {
  const badCard = '## Goal\n- only one section';
  const backend = fakeBackend({}, [
    () => badCard,
    () => '## Goal\n- ok\n\n## Key Decisions\n- d\n\n## Constraints & Preferences\n- c\n\n## Current State\n- s\n\n## Resources & Links\n- https://example.com/spec\n\n## Open Questions\n- None noted.',
  ]);
  const result = await runExtraction({ input: VALID_INPUT, level: 'balanced', backend });

  assert.equal(backend.calls.length, 2);
  const retry = backend.calls[1];
  assert.ok(retry, 'expected a retry call');
  assert.equal(retry.temperature, 0);
  assert.match(retry.system, /MISSING_SECTION/);
  assert.equal(result.valid, true);
});

test('a card that fails twice is returned with a warning and exit-code 5 semantics', async () => {
  const badCard = '## Goal\n- still broken';
  const backend = fakeBackend({}, [() => badCard, () => badCard]);
  const result = await runExtraction({ input: VALID_INPUT, level: 'balanced', backend });

  assert.equal(result.valid, false);
  assert.equal(result.problems.some((p) => p.code === 'MISSING_SECTION'), true);
  const warning = result.warnings.join('\n');
  assert.match(warning, /failed format validation/);
  assert.match(warning, /MISSING_SECTION/);
  assert.ok(EXIT.VALIDATION === 5);
});

test('cloud map steps run concurrently and still merge in order', async () => {
  const turns: string[] = [];
  for (let i = 0; i < 30; i++) turns.push(`user: turn ${i} — ${'content '.repeat(40)}`);
  const input = turns.join('\n\n') + ' ' + VALID_INPUT;
  const backend = fakeBackend({ isLocal: false, destination: 'api.example.com', contextWindowTokens: 1500 });
  const result = await runExtraction({ input, level: 'balanced', backend });
  assert.equal(result.chunked, true);
  assert.ok(result.chunks > 1);
  assert.equal(result.valid, true);
  assert.ok(backend.calls.length >= result.chunks);
});

// ---------- --offline guard (PRD R13, TRD §7.4) ----------

test('--offline allows loopback Ollama', () => {
  const backend = createOllamaBackend({ host: 'http://127.0.0.1:11434' });
  assert.doesNotThrow(() => assertOfflineAllowed(backend, true));
});

test('--offline refuses a remote OLLAMA_HOST, naming the destination', () => {
  const backend = createOllamaBackend({ host: 'http://gpu-box.local:11434' });
  assert.equal(backend.isLocal, false);
  try {
    assertOfflineAllowed(backend, true);
    assert.fail('expected refusal');
  } catch (err) {
    assert.equal((err as { exitCode?: number }).exitCode, 2);
    assert.match((err as Error).message, /gpu-box\.local:11434/);
  }
});

test('--offline refuses both cloud backends', () => {
  for (const backend of [createAnthropicBackend(), createNimBackend()]) {
    assert.throws(() => assertOfflineAllowed(backend, true), (err: unknown) => (err as { exitCode?: number }).exitCode === 2);
  }
  // Without --offline they are fine.
  assert.doesNotThrow(() => assertOfflineAllowed(createAnthropicBackend(), false));
  assert.doesNotThrow(() => assertOfflineAllowed(createNimBackend(), false));
});
