'use strict';

/**
 * Cloud extraction backend — NVIDIA NIM (OpenAI-compatible chat completions).
 * TRD §4: same fail-fast pattern as Anthropic; key comes ONLY from
 * NVIDIA_NIM_API_KEY (TRD §5).
 */

const { systemPrompt, retrySystemPrompt, userMessage } = require('../prompt');
const { extractValidated } = require('../validate');

const API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
// Current NIM catalog default; override per-call via --model / config.
const DEFAULT_MODEL = 'meta/llama-3.1-8b-instruct';
const MAX_TOKENS = 1024;

function requireApiKey() {
  const key = (process.env.NVIDIA_NIM_API_KEY || '').trim();
  if (!key) {
    // Fail fast BEFORE any network call.
    const e = new Error('Set NVIDIA_NIM_API_KEY to use the NVIDIA NIM backend.');
    e.code = 'MISSING_API_KEY';
    throw e;
  }
  return key;
}

function extractText(data) {
  let root;
  try {
    root = JSON.parse(data);
  } catch {
    throw new Error('NIM response was not a JSON object.');
  }
  if (root && root.error) {
    const message = root.error.message || JSON.stringify(root.error);
    throw new Error('NIM error: ' + message);
  }
  const choice = root && Array.isArray(root.choices) ? root.choices[0] : undefined;
  const content = choice && choice.message && typeof choice.message.content === 'string'
    ? choice.message.content
    : '';
  const text = content.trim();
  if (!text) throw new Error('NIM responded but contained no text content.');
  return text;
}

async function rawExtract(apiKey, model, conversation, strict) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + apiKey,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: strict ? retrySystemPrompt() : systemPrompt() },
          { role: 'user', content: userMessage(conversation) },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (res.status !== 200) {
    const snippet = text ? text.slice(0, 300) : '(no response body)';
    throw new Error('NVIDIA NIM API returned HTTP ' + res.status + '. Response: ' + snippet);
  }
  return extractText(text);
}

/**
 * extract(text, options) -> Promise<string>
 * options: { model, onWarning }
 */
async function extract(text, options = {}) {
  const apiKey = requireApiKey();
  const model = options.model || process.env.NVIDIA_NIM_MODEL || DEFAULT_MODEL;
  const rawCall = (input, opts = {}) => rawExtract(apiKey, model, input, !!opts.strict);
  const { card, needsFormatWarning } = await extractValidated(rawCall, text);
  if (needsFormatWarning && typeof options.onWarning === 'function') {
    options.onWarning(
      'This card may be missing sections — the model didn\u2019t follow the expected format. Review before using.'
    );
  }
  return card;
}

module.exports = { extract, requireApiKey, DEFAULT_MODEL };
