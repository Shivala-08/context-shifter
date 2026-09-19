'use strict';

/**
 * Local extraction backend — Ollama running on the user's machine.
 * Mirrors Sources/ContextTransfer/OllamaBackend.swift: same endpoint, same
 * num_ctx/keep_alive/think fields, same error guidance.
 */

const { systemPrompt, retrySystemPrompt } = require('../prompt');
const { extractValidated, stripThinkBlocks } = require('../validate');

const NUM_CTX = 8192;
const KEEP_ALIVE = '10m';

const DEFAULT_HOST = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen3:8b';

function normalizedHost(host) {
  let trimmed = String(host || '').trim();
  if (!trimmed) trimmed = DEFAULT_HOST;
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

function extractText(data) {
  let root;
  try {
    root = JSON.parse(data);
  } catch {
    throw new Error('Ollama response was not a JSON object.');
  }
  if (root && typeof root.error === 'string') {
    throw new Error('Ollama error: ' + root.error);
  }
  if (!root || typeof root.response !== 'string') {
    throw new Error('Unexpected Ollama response: missing `response` string field.');
  }
  // Local models (qwen3…) intermittently emit reasoning blocks; strip them.
  const text = stripThinkBlocks(root.response);
  if (!text) throw new Error('Ollama responded but contained no text content.');
  return text;
}

async function postJson(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function buildRequestBody(conversation, strict) {
  // Ollama's /api/generate has no separate system-prompt field — concatenate
  // system prompt + conversation into one prompt string, like the Swift app.
  // (The `model` field is filled in by the caller from options/env/config.)
  const base = strict ? retrySystemPrompt() : systemPrompt();
  return {
    prompt:
      base +
      '\n\nHere is the conversation to extract from:\n\n' +
      conversation,
    stream: false,
    keep_alive: KEEP_ALIVE,
    // Thinking models (qwen3…) default to emitting <think> blocks we strip
    // anyway — skip generating them at all. Older servers ignore this field.
    think: false,
    options: { num_ctx: NUM_CTX, num_predict: 1024 },
  };
}

async function rawExtract(host, model, conversation, strict) {
  const trimmedHost = normalizedHost(host);
  const url = trimmedHost + '/api/generate';
  const body = buildRequestBody(conversation, strict);
  body.model = model;

  let res;
  try {
    // Local 8B models can be slow — same 300s timeout as the Swift app.
    res = await postJson(url, body, 300_000);
  } catch (err) {
    const reason =
      err && err.name === 'AbortError'
        ? 'request timed out'
        : err && err.cause && err.cause.code
          ? err.cause.code
          : String((err && err.message) || err);
    const e = new Error(
      "Couldn't reach Ollama at " + trimmedHost + '. Run `ollama serve` and make sure the model is pulled (`ollama pull ' + model + '`). (' + reason + ')'
    );
    e.code = 'OLLAMA_UNREACHABLE';
    throw e;
  }

  if (res.status !== 200) {
    const lower = res.text.toLowerCase();
    // OOM on model load has a different fix than connection trouble —
    // surface it specifically, like the Swift app does.
    if (res.status === 500 && (lower.includes('memory') || lower.includes('allocat'))) {
      throw new Error('Ollama ran out of memory loading this model. Try a smaller model or close other apps.');
    }
    const snippet = res.text ? res.text.slice(0, 300) : '(no response body)';
    throw new Error('Ollama returned HTTP ' + res.status + '. Response: ' + snippet);
  }

  return extractText(res.text);
}

/**
 * extract(text, options) -> Promise<string>
 * options: { host, model, onWarning }
 */
async function extract(text, options = {}) {
  const host = normalizedHost(options.host || process.env.OLLAMA_HOST);
  const model = options.model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;
  const rawCall = (input, opts = {}) => rawExtract(host, model, input, !!opts.strict);
  const { card, needsFormatWarning } = await extractValidated(rawCall, text);
  if (needsFormatWarning && typeof options.onWarning === 'function') {
    options.onWarning(
      'This card may be missing sections — the model didn\u2019t follow the expected format. Review before using.'
    );
  }
  return card;
}

module.exports = { extract, normalizedHost, NUM_CTX, KEEP_ALIVE };
