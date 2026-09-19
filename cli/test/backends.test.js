'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Tests use the default export surface; http interception is process-global,
// so suites run sequentially via node:test's default per-file concurrency.
const ollama = require('../src/backends/ollama');
const anthropic = require('../src/backends/anthropic');
const nim = require('../src/backends/nim');

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

function makeCardText() {
  return VALID_CARD;
}

// ---------- ollama ----------

test('ollama: unreachable host produces the exact actionable error', async () => {
  // RFC 5737 documentation port — nothing should be listening, and the
  // connection fails fast instead of hanging.
  const host = 'http://127.0.0.1:9';
  await assert.rejects(
    () => ollama.extract('conversation text', { host, model: 'qwen3:8b' }),
    (err) => {
      assert.match(err.message, /Couldn't reach Ollama at http:\/\/127\.0\.0\.1:9/);
      assert.match(err.message, /ollama serve/);
      assert.match(err.message, /ollama pull qwen3:8b/);
      return true;
    }
  );
});

test('ollama: happy path returns card and normalizes headers', async () => {
  const bodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ response: makeCardText() }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const card = await ollama.extract('conversation', { host: 'http://127.0.0.1:9/', model: 'test-model' });
    assert.equal(card, VALID_CARD);
    // Same request shape as the Swift app: num_ctx, keep_alive, think, stream.
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].model, 'test-model');
    assert.equal(bodies[0].stream, false);
    assert.equal(bodies[0].keep_alive, '10m');
    assert.equal(bodies[0].think, false);
    assert.equal(bodies[0].options.num_ctx, 8192);
    assert.equal(bodies[0].options.num_predict, 1024);
    assert.match(bodies[0].prompt, /Here is the conversation to extract from:/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ollama: HTTP 500 with memory error surfaces the OOM message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'model loader requires more memory than available' }), { status: 500 });
  try {
    await assert.rejects(
      () => ollama.extract('conversation', { host: 'http://127.0.0.1:9', model: 'qwen3:8b' }),
      /ran out of memory/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ollama: strips <think> blocks from the model response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ response: '<think>reasoning</think>\n' + VALID_CARD }), { status: 200 });
  try {
    const card = await ollama.extract('conversation', { host: 'http://127.0.0.1:9', model: 'm' });
    assert.equal(card.includes('<think>'), false);
    assert.equal(card, VALID_CARD);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------- anthropic ----------

test('anthropic: missing key fails fast before any network call', async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response('{}', { status: 401 });
  };
  try {
    await assert.rejects(
      () => anthropic.extract('conversation', {}),
      (err) => {
        assert.match(err.message, /^Set ANTHROPIC_API_KEY to use the Anthropic backend\.$/);
        return true;
      }
    );
    assert.equal(fetchCalled, false, 'must not reach the network without a key');
  } finally {
    process.env.ANTHROPIC_API_KEY = previous;
    globalThis.fetch = originalFetch;
  }
});

test('anthropic: sends the exact request shape the Swift app sends', async () => {
  const bodies = [];
  const headers = [];
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  globalThis.fetch = async (url, init) => {
    headers.push(init.headers);
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ content: [{ type: 'text', text: makeCardText() }] }), { status: 200 });
  };
  try {
    const card = await anthropic.extract('conversation', {});
    assert.equal(card, VALID_CARD);
    assert.equal(bodies[0].model, 'claude-sonnet-4-6');
    assert.equal(bodies[0].max_tokens, 1024);
    assert.ok(bodies[0].system.startsWith('You extract a portable'));
    assert.deepEqual(bodies[0].messages, [
      { role: 'user', content: 'Here is the conversation to extract from:\n\nconversation' },
    ]);
    assert.equal(headers[0]['x-api-key'], 'sk-ant-test');
    assert.equal(headers[0]['anthropic-version'], '2023-06-01');
  } finally {
    process.env.ANTHROPIC_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  }
});

test('anthropic: API error body becomes a readable message', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 });
  try {
    await assert.rejects(() => anthropic.extract('conversation', {}), /Anthropic API returned HTTP 401/);
  } finally {
    process.env.ANTHROPIC_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  }
});

// ---------- nim ----------

test('nim: missing key fails fast before any network call', async () => {
  const previous = process.env.NVIDIA_NIM_API_KEY;
  delete process.env.NVIDIA_NIM_API_KEY;
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response('{}', { status: 401 });
  };
  try {
    await assert.rejects(
      () => nim.extract('conversation', {}),
      (err) => {
        assert.match(err.message, /^Set NVIDIA_NIM_API_KEY to use the NVIDIA NIM backend\.$/);
        return true;
      }
    );
    assert.equal(fetchCalled, false, 'must not reach the network without a key');
  } finally {
    process.env.NVIDIA_NIM_API_KEY = previous;
    globalThis.fetch = originalFetch;
  }
});

test('nim: uses OpenAI-compatible chat completions schema', async () => {
  const bodies = [];
  const headers = [];
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.NVIDIA_NIM_API_KEY;
  process.env.NVIDIA_NIM_API_KEY = 'nvapi-test';
  globalThis.fetch = async (url, init) => {
    headers.push(init.headers);
    bodies.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: makeCardText() } }] }),
      { status: 200 }
    );
  };
  try {
    const card = await nim.extract('conversation', {});
    assert.equal(card, VALID_CARD);
    assert.equal(bodies[0].model, 'meta/llama-3.1-8b-instruct');
    assert.equal(bodies[0].max_tokens, 1024);
    assert.equal(bodies[0].messages[0].role, 'system');
    assert.ok(bodies[0].messages[0].content.startsWith('You extract a portable'));
    assert.equal(bodies[0].messages[1].content, 'Here is the conversation to extract from:\n\nconversation');
    assert.equal(headers[0].authorization, 'Bearer nvapi-test');
  } finally {
    process.env.NVIDIA_NIM_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  }
});
