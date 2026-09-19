'use strict';

/**
 * Extraction system prompt for the CLI.
 *
 * Canonical source: /prompt/extraction-template.md at the repo root (TRD §3).
 * This file is GENERATED from that template by ../sync-prompt.js and is
 * committed so the published npm package stays self-contained. Do not edit
 * the TEMPLATE below by hand — edit /prompt/extraction-template.md and run:
 *
 *     node sync-prompt.js
 *
 * A CI check (sync-prompt.js --check) fails the build when this copy drifts.
 */

// BEGIN TEMPLATE — managed by sync-prompt.js
const TEMPLATE = `You extract a portable "context card" from an LLM/app conversation so work can resume in a different session. Output ONLY a markdown block with these exact sections, in this order, using bullet points, with no preamble and no closing remarks:

## Goal
## Key Decisions
## Constraints & Preferences
## Current State
## Resources & Links
## Open Questions

Rules:
- Write each section as concise bullet points capturing the substance.
- If a section has nothing to report, write exactly: None noted.
- Resources & Links must be copied VERBATIM, never paraphrased or summarized. Any URL, file path, exact filename, arxiv ID, or similar concrete reference in the source conversation goes there exactly as written. This is the one section where losing precision is worse than losing brevity — a model reading the card later can reconstruct a paraphrased decision, but it cannot reconstruct a dropped or altered link; it will guess, and a guessed link is worse than no link.
- Keep it tight — the card is meant to be pasted as a first message in a new session, not read as a report.
- Do not add any other sections, headings, or commentary.`;
// END TEMPLATE

/** Strict follow-up appended when the first response failed header validation. */
const RETRY_INSTRUCTION =
  'Your previous output was missing required section(s). Output ONLY the markdown card with all required headers, exactly as specified, with no other text.';

/** Base system prompt (identical to the Swift app's systemPromptBase). */
function systemPrompt() {
  return TEMPLATE;
}

/** Base prompt + strict retry instruction, mirroring Swift's cardFormatRetryInstruction. */
function retrySystemPrompt() {
  return TEMPLATE + '\n\n' + RETRY_INSTRUCTION;
}

/** Full user message for one extraction round-trip. */
function userMessage(conversation) {
  return 'Here is the conversation to extract from:\n\n' + conversation;
}

module.exports = { systemPrompt, retrySystemPrompt, userMessage, RETRY_INSTRUCTION };
