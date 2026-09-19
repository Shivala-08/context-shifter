'use strict';

/**
 * Card shape validation — port of the Swift app's Task 4b logic
 * (ExtractionBackend.swift: requiredCardHeaders / validateContextCard /
 * ContextCardValidation). Keep in sync with that file.
 */

// Same headers, same order as the Swift app's requiredCardHeaders.
const REQUIRED_HEADERS = [
  'Captured on:',
  '## Goal',
  '## Key Decisions',
  '## Constraints & Preferences',
  '## Current State',
  '## Resources & Links',
  '## Open Questions',
];

// "Captured on: 2026-09-19" — same date format the Swift app stamps.
const CARD_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True when the card contains every required header. */
function validateCard(text) {
  return REQUIRED_HEADERS.every((h) => text.includes(h));
}

function todayStamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Post-process a raw model response before validation:
 * - strips a leading ```markdown fence (local models add one despite the prompt)
 * - stamps "Captured on:" client-side — never requested from the model,
 *   because small local models reliably drop it and trigger a pointless retry
 */
function normalizeCard(text) {
  let trimmed = String(text).trim();

  if (trimmed.startsWith('```')) {
    const firstNewline = trimmed.indexOf('\n');
    if (firstNewline === -1) {
      trimmed = '';
    } else {
      trimmed = trimmed.slice(firstNewline + 1);
      if (trimmed.endsWith('```')) {
        trimmed = trimmed.slice(0, -3);
      }
    }
    trimmed = trimmed.trim();
  }

  if (trimmed.toLowerCase().includes('captured on:')) return trimmed;
  return `Captured on: ${todayStamp()}\n\n${trimmed}`;
}

/**
 * One backend round-trip wrapper with the Task 4b retry flow:
 * validate → retry once with the strict instruction → warn if still malformed.
 *
 * @param {(input: string, opts?: {strict?: boolean}) => Promise<string>} rawCall
 *   Performs one API round-trip for the given user input. `strict` requests
 *   the retry system prompt (Swift re-sends the full conversation with the
 *   corrective instruction; the CLI achieves the same with a stricter system
 *   prompt, which works for all three backends alike).
 * @param {string} conversation
 * @returns {Promise<{card: string, needsFormatWarning: boolean}>}
 */
async function extractValidated(rawCall, conversation) {
  const first = normalizeCard(await rawCall(conversation));
  if (validateCard(first)) return { card: first, needsFormatWarning: false };

  const second = normalizeCard(await rawCall(conversation, { strict: true }));
  if (validateCard(second)) return { card: second, needsFormatWarning: false };
  return { card: second, needsFormatWarning: true };
}

/** Shared strip of <think>…</think> reasoning blocks (qwen3 et al.). */
function stripThinkBlocks(text) {
  // [\s\S]*? instead of the `s` regex flag — keeps the regex ES2018-safe.
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
    .trim();
}

module.exports = {
  REQUIRED_HEADERS,
  CARD_DATE_PATTERN,
  validateCard,
  normalizeCard,
  extractValidated,
  stripThinkBlocks,
  todayStamp,
};
