import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createAnthropicBackend } from '../src/backends/anthropic.js';
import { createNimBackend } from '../src/backends/nim.js';
import { createOllamaBackend, isLoopbackHost } from '../src/backends/ollama.js';
import { BackendError } from '../src/backends/types.js';
import type { Backend, CompletionRequest } from '../src/backends/types.js';

const REQ: CompletionRequest = {
  system: 'You are an extractor.',
  user: 'conversation text',
  maxOutputTokens: 1024,
  temperature: 0.1,
};

interface CapturedRequest {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

interface MockServer {
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

/**
 * Local mock HTTP server (TRD §13 "backend contract"): records requests and
 * answers with caller-controlled responses (body or status codes).
 */
async function startMock(
  respond: (req: CapturedRequest) => { status: number; body: string; headers?: Record<string, string> }
): Promise<MockServer> {
  const requests: CapturedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = { raw };
      }
      const captured: CapturedRequest = { url: req.url ?? '', headers: req.headers, body };
      requests.push(captured);
      const r = respond(captured);
      res.writeHead(r.status, r.headers ?? {});
      res.end(r.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** A port that nothing is listening on — for connection-refused assertions. */
async function deadPort(): Promise<string> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

const CARD = '## Goal\n- x';

function expectBackendError(fn: () => Promise<unknown>, expectedExit: number): Promise<BackendError> {
  return fn().then(
    () => {
      throw new Error('expected the call to reject');
    },
    (err: unknown) => {
      assert.ok(err instanceof BackendError, `expected BackendError, got ${String(err)}`);
      assert.equal((err as BackendError).exitCode, expectedExit);
      return err as BackendError;
    }
  );
}

// ---------- Ollama ----------

test('ollama: success returns content + real usage and sends an explicit num_ctx', async () => {
  const mock = await startMock(() => ({
    status: 200,
    body: JSON.stringify({ message: { content: CARD }, prompt_eval_count: 11, eval_count: 7 }),
  }));
  try {
    const backend = createOllamaBackend({ host: mock.url });
    const res = await backend.complete(REQ, new AbortController().signal);
    assert.equal(res.text, CARD);
    assert.deepEqual(res.usage, { inputTokens: 11, outputTokens: 7 });

    assert.equal(mock.requests.length, 1);
    const body = mock.requests[0]?.body as { stream?: unknown; think?: unknown; options?: { num_ctx?: number; temperature?: number }; messages?: unknown[] };
    assert.equal(body.stream, false);
    assert.equal(body.think, false);
    assert.equal(body.options?.num_ctx, 8192);
    assert.equal(body.options?.temperature, 0.1);
    assert.equal((body.messages as Array<{ role: string }>)?.[0]?.role, 'system');
    assert.ok(mock.requests[0]?.url?.includes('/api/chat'));
  } finally {
    await mock.close();
  }
});

test('ollama: unknown model maps to exit 3 with an actionable hint', async () => {
  const mock = await startMock(() => ({ status: 404, body: 'nope' }));
  try {
    const err = await expectBackendError(
      () => createOllamaBackend({ host: mock.url, model: 'ghost:1b' }).complete(REQ, new AbortController().signal),
      3
    );
    assert.match(err.hint ?? '', /ollama pull ghost:1b/);
  } finally {
    await mock.close();
  }
});

test('ollama: OOM on load gets a specific message', async () => {
  const mock = await startMock(() => ({ status: 500, body: '{"error":"memory allocation failed"}' }));
  try {
    const err = await expectBackendError(
      () => createOllamaBackend({ host: mock.url }).complete(REQ, new AbortController().signal),
      3
    );
    assert.match(err.message, /out of memory/i);
  } finally {
    await mock.close();
  }
});

test('ollama: connection refused maps to exit 3 with "ollama serve" hint', async () => {
  const backend = createOllamaBackend({ host: await deadPort() });
  const err = await expectBackendError(() => backend.complete(REQ, new AbortController().signal), 3);
  assert.match(err.hint ?? '', /ollama serve/);
  assert.match(err.message, /isn't reachable/);
});

test('ollama: malformed JSON response is a backend error, not a crash', async () => {
  const mock = await startMock(() => ({ status: 200, body: '<html>not json</html>' }));
  try {
    await expectBackendError(
      () => createOllamaBackend({ host: mock.url }).complete(REQ, new AbortController().signal),
      3
    );
  } finally {
    await mock.close();
  }
});

test('ollama: preflight reports reachability and model count', async () => {
  const mock = await startMock((req) =>
    req.url?.includes('/api/tags')
      ? { status: 200, body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) }
      : { status: 404, body: '' }
  );
  try {
    const ok = await createOllamaBackend({ host: mock.url }).preflight();
    assert.equal(ok.ok, true);
    assert.match(ok.detail, /1 model/);
    const bad = await createOllamaBackend({ host: await deadPort() }).preflight();
    assert.equal(bad.ok, false);
  } finally {
    await mock.close();
  }
});

test('ollama: --offline semantics come from the RESOLVED host (TRD §6.1)', () => {
  assert.equal(createOllamaBackend({ host: 'http://localhost:11434' }).isLocal, true);
  assert.equal(createOllamaBackend({ host: 'http://127.0.0.1:11434' }).isLocal, true);
  assert.equal(createOllamaBackend({ host: 'http://gpu-box.local:11434' }).isLocal, false);
  assert.equal(createOllamaBackend({ host: 'http://192.168.1.5:11434' }).isLocal, false);
  assert.equal(isLoopbackHost('http://[::1]:11434'), true);
  assert.equal(isLoopbackHost('not a url'), false);
});

// ---------- Anthropic ----------

test('anthropic: success concatenates text blocks and maps usage', async () => {
  const mock = await startMock(() => ({
    status: 200,
    body: JSON.stringify({
      content: [
        { type: 'text', text: '## Goal' },
        { type: 'text', text: '- x' },
      ],
      usage: { input_tokens: 100, output_tokens: 21 },
    }),
  }));
  try {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const backend = createAnthropicBackend({ baseUrl: mock.url });
    const res = await backend.complete(REQ, new AbortController().signal);
    assert.equal(res.text, '## Goal\n- x');
    assert.deepEqual(res.usage, { inputTokens: 100, outputTokens: 21 });

    const headers = mock.requests[0]?.headers ?? {};
    assert.equal(headers['x-api-key'], 'test-key');
    assert.equal(headers['anthropic-version'], '2023-06-01');
    const body = mock.requests[0]?.body as { model?: string; max_tokens?: number; system?: string };
    assert.equal(body.model, 'claude-sonnet-4-6');
    assert.equal(body.max_tokens, 1024);
    assert.equal(body.system, REQ.system);
  } finally {
    await mock.close();
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('anthropic: 401 maps to exit 4 with a key hint', async () => {
  const mock = await startMock(() => ({ status: 401, body: '{"error":{"message":"bad key"}}' }));
  try {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const err = await expectBackendError(
      () => createAnthropicBackend({ baseUrl: mock.url }).complete(REQ, new AbortController().signal),
      4
    );
    assert.match(err.hint ?? '', /ANTHROPIC_API_KEY/);
  } finally {
    await mock.close();
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('anthropic: 429 honours retry-after and then succeeds', async () => {
  let calls = 0;
  const mock = await startMock(() => {
    calls++;
    if (calls === 1) {
      return { status: 429, body: 'rate limited', headers: { 'retry-after': '0.1' } };
    }
    return { status: 200, body: JSON.stringify({ content: [{ type: 'text', text: CARD }] }) };
  });
  try {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const res = await createAnthropicBackend({ baseUrl: mock.url }).complete(REQ, new AbortController().signal);
    assert.equal(res.text, CARD);
    assert.equal(calls, 2);
  } finally {
    await mock.close();
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('anthropic: exhausts transport retries on persistent 5xx (exit 3)', async () => {
  let calls = 0;
  const mock = await startMock(() => {
    calls++;
    return { status: 500, body: 'boom', headers: { 'retry-after': '0.1' } };
  });
  try {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const err = await expectBackendError(
      () => createAnthropicBackend({ baseUrl: mock.url }).complete(REQ, new AbortController().signal),
      3
    );
    assert.match(err.message, /HTTP 500/);
    assert.equal(calls, 3); // 1 initial + 2 retries (TRD §7.2)
  } finally {
    await mock.close();
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('anthropic: missing key fails BEFORE any network call (PRD R12)', async () => {
  const mock = await startMock(() => ({ status: 200, body: '{}' }));
  try {
    delete process.env.ANTHROPIC_API_KEY;
    const err = await expectBackendError(
      () => createAnthropicBackend({ baseUrl: mock.url }).complete(REQ, new AbortController().signal),
      4
    );
    assert.match(err.message, /ANTHROPIC_API_KEY/);
    assert.equal(mock.requests.length, 0);
  } finally {
    await mock.close();
  }
});

// ---------- NVIDIA NIM ----------

test('nim: success parses the OpenAI-compatible shape', async () => {
  const mock = await startMock(() => ({
    status: 200,
    body: JSON.stringify({
      choices: [{ message: { content: CARD } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }),
  }));
  try {
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    const backend = createNimBackend({ baseUrl: mock.url });
    const res = await backend.complete(REQ, new AbortController().signal);
    assert.equal(res.text, CARD);
    assert.deepEqual(res.usage, { inputTokens: 100, outputTokens: 20 });

    assert.equal(mock.requests[0]?.headers?.authorization, 'Bearer nvapi-test');
    const body = mock.requests[0]?.body as { model?: string; messages?: Array<{ role: string }> };
    assert.equal(body.model, 'meta/llama-3.1-8b-instruct');
    assert.equal((body.messages as Array<{ role: string }> | undefined)?.[0]?.role, 'system');
  } finally {
    await mock.close();
    delete process.env.NVIDIA_API_KEY;
  }
});

test('nim: 401 maps to exit 4 with a key hint', async () => {
  const mock = await startMock(() => ({ status: 401, body: '{"error":"unauthorized"}' }));
  try {
    process.env.NVIDIA_API_KEY = 'nvapi-bad';
    const err = await expectBackendError(
      () => createNimBackend({ baseUrl: mock.url }).complete(REQ, new AbortController().signal),
      4
    );
    assert.match(err.hint ?? '', /NVIDIA_API_KEY/);
  } finally {
    await mock.close();
    delete process.env.NVIDIA_API_KEY;
  }
});

test('nim: API error object in a 200 envelope surfaces the message', async () => {
  const mock = await startMock(() => ({
    status: 200,
    body: JSON.stringify({ error: { message: 'quota exceeded' } }),
  }));
  try {
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    const err = await expectBackendError(
      () => createNimBackend({ baseUrl: mock.url }).complete(REQ, new AbortController().signal),
      3
    );
    assert.match(err.message, /quota exceeded/);
  } finally {
    await mock.close();
    delete process.env.NVIDIA_API_KEY;
  }
});

test('a pre-aborted signal aborts the request without hanging', async () => {
  const mock = await startMock(() => ({ status: 200, body: JSON.stringify({ message: { content: CARD } }) }));
  try {
    const controller = new AbortController();
    controller.abort();
    const backend: Backend = createOllamaBackend({ host: mock.url });
    await assert.rejects(() => backend.complete(REQ, controller.signal));
  } finally {
    await mock.close();
  }
});
