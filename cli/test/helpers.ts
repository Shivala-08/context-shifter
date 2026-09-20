/** Shared test helpers. */

import type { Backend, CompletionRequest, CompletionResult } from '../src/backends/types.js';

export const VALID_CARD = `Captured on: 2026-09-19

## Goal
- Ship the CLI

## Key Decisions
- Zero dependencies

## Constraints & Preferences
- Node >= 20

## Current State
- Tests passing

## Resources & Links
- https://example.com/spec

## Open Questions
- None noted.`;

/** Conversation containing the URLs the VALID_CARD claims (link fidelity). */
export const VALID_INPUT =
  'Discussion about shipping. See https://example.com/spec for the API spec. Ship the CLI, zero dependencies.';

/** Scriptable fake backend for pipeline tests. */
export function fakeBackend(overrides: Partial<Backend> = {}, responses: Array<(req: CompletionRequest) => string> = []): Backend & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  let i = 0;
  const base: Backend = {
    id: 'ollama',
    isLocal: true,
    contextWindowTokens: 8192,
    destination: 'http://127.0.0.1:11434',
    async complete(req: CompletionRequest, _signal: AbortSignal): Promise<CompletionResult> {
      calls.push(req);
      const responder = responses[Math.min(i, responses.length - 1)];
      i++;
      return { text: responder ? responder(req) : VALID_CARD, usage: { inputTokens: 100, outputTokens: 50 } };
    },
    async preflight() {
      return { ok: true, detail: 'ok' };
    },
  };
  return Object.assign(base, { calls }, overrides) as Backend & { calls: CompletionRequest[] };
}
