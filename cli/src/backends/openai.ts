/**
 * OpenAI backend (cloud, OpenAI-compatible preset) — TRD §7.3.
 * Key comes ONLY from OPENAI_API_KEY (PRD R12: keys are never flags).
 *
 * Default model `gpt-4o-mini`: long-lived, cheap, and it accepts the classic
 * `max_tokens` + `temperature` request shape. Newer reasoning models that
 * reject `max_tokens` are covered by the compat layer's 400-fallback
 * (openai-compat.ts); pick them explicitly with --model.
 */

import { createOpenAiCompatBackend, type OpenAiCompatPreset } from './openai-compat.js';
import type { Backend, BackendOptions } from './types.js';

export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_MODEL = 'gpt-4o-mini';
/** gpt-4o-mini serves a 128k window; stay conservative (TRD §7.2 style). */
export const INPUT_BUDGET_TOKENS = 100_000;

export const OPENAI_PRESET: OpenAiCompatPreset = {
  id: 'openai',
  displayName: 'OpenAI',
  defaultBaseUrl: DEFAULT_BASE_URL,
  apiKeyEnvs: ['OPENAI_API_KEY'],
  defaultModel: DEFAULT_MODEL,
  modelEnv: 'OPENAI_MODEL',
  inputBudgetTokens: INPUT_BUDGET_TOKENS,
};

export function createOpenAiBackend(options: BackendOptions = {}): Backend {
  return createOpenAiCompatBackend(OPENAI_PRESET, options);
}
