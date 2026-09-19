'use strict';

/**
 * Cloud extraction backend — Anthropic Messages API.
 * Mirrors Sources/ContextTransfer/AnthropicBackend.swift: same endpoint,
 * same model, same headers. Key comes ONLY from ANTHROPIC_API_KEY (TRD §5).
 */

const { systemPrompt, retrySystemPrompt, userMessage } = require('../prompt');
const { extractValidated } = require('../validate');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;

function requireApiKey() {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) {
    // Fail fast BEFORE any network call — never a raw 401 stack trace.
    const e = new Error('Set ANTHROPIC_API_KEY to use the Anthropic backend.');
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
    throw new Error('Anthropic response was not a JSON object.');
  }
  if (root && root.error) {
    const message = root.error.message || 'unknown API error';
    throw new Error('Anthropic error: ' + message);
  }
  if (!root || !Array.isArray(root.content)) {
    throw new Error('Unexpected Anthropic response: missing `content` array.');
  }
  const joined = root.content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n');
  if (!joined) throw new Error('Anthropic API responded but contained no text content.');
  return joined;
}

async function rawExtract(apiKey, conversation, strict) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: strict ? retrySystemPrompt() : systemPrompt(),
        messages: [{ role: 'user', content: userMessage(conversation) }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (res.status !== 200) {
    const snippet = text ? text.slice(0, 300) : '(no response body)';
    throw new Error('Anthropic API returned HTTP ' + res.status + '. Response: ' + snippet);
  }
  return extractText(text);
}

/**
 * extract(text, options) -> Promise<string>
 * options: { onWarning }
 */
async function extract(text, options = {}) {
  const apiKey = requireApiKey();
  const rawCall = (input, opts = {}) => rawExtract(apiKey, input, !!opts.strict);
  const { card, needsFormatWarning } = await extractValidated(rawCall, text);
  if (needsFormatWarning && typeof options.onWarning === 'function') {
    options.onWarning(
      'This card may be missing sections — the model didn\u2019t follow the expected format. Review before using.'
    );
  }
  return card;
}

module.exports = { extract, requireApiKey, MODEL };
