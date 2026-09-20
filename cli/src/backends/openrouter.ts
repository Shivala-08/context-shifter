/**
 * OpenRouter backend (cloud, OpenAI-compatible preset) — TRD §7.3.
 * One key (OPENROUTER_API_KEY) unlocks hundreds of models via
 * `vendor/model` ids (e.g. `anthropic/claude-sonnet-4.5`,
 * `meta/llama-3.1-8b-instruct`) — the cheapest way to support "every cloud
 * model" without adding per-vendor backends.
 *
 * Default model `openai/gpt-4o-mini`: cheap, widely available, and accepts
 * the classic request shape. Model IDs churn on OpenRouter — verify the
 * default at release time and override with --model.
 */

import { createOpenAiCompatBackend, type OpenAiCompatPreset } from './openai-compat.js';
import type { Backend, BackendOptions } from './types.js';

export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';
/** Model windows on OpenRouter range from 8k to 1M+; stay conservative. */
export const INPUT_BUDGET_TOKENS = 24_000;

export const OPENROUTER_PRESET: OpenAiCompatPreset = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  defaultBaseUrl: DEFAULT_BASE_URL,
  apiKeyEnvs: ['OPENROUTER_API_KEY'],
  defaultModel: DEFAULT_MODEL,
  modelEnv: 'OPENROUTER_MODEL',
  inputBudgetTokens: INPUT_BUDGET_TOKENS,
};

export function createOpenRouterBackend(options: BackendOptions = {}): Backend {
  return createOpenAiCompatBackend(OPENROUTER_PRESET, options);
}
