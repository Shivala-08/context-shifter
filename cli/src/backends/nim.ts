/**
 * NVIDIA NIM backend (cloud, OpenAI-compatible) — TRD §7.3. A thin preset
 * over the shared compat layer (backends/openai-compat.ts); behaviour and
 * error messages are unchanged. NIM_BASE_URL can point at a self-hosted NIM.
 * Key comes ONLY from NVIDIA_API_KEY (NVIDIA_NIM_API_KEY accepted as a legacy
 * alias from the pre-rename CLI).
 */

import { createOpenAiCompatBackend, type OpenAiCompatPreset } from './openai-compat.js';
import { BackendError, type Backend, type BackendOptions } from './types.js';
import { EXIT } from '../core/errors.js';

export const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_MODEL = 'meta/llama-3.1-8b-instruct';
/** Varies per model; override with --model at the CLI layer (TRD §7.3). */
export const INPUT_BUDGET_TOKENS = 24_000;

export const NIM_PRESET: OpenAiCompatPreset = {
  id: 'nim',
  displayName: 'NVIDIA NIM',
  defaultBaseUrl: DEFAULT_BASE_URL,
  baseUrlEnv: 'NIM_BASE_URL',
  apiKeyEnvs: ['NVIDIA_API_KEY', 'NVIDIA_NIM_API_KEY'],
  defaultModel: DEFAULT_MODEL,
  modelEnv: 'NVIDIA_NIM_MODEL',
  inputBudgetTokens: INPUT_BUDGET_TOKENS,
};

export function resolveBaseUrl(): string {
  let base = (process.env.NIM_BASE_URL || '').trim() || DEFAULT_BASE_URL;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return base;
}

export function requireApiKey(): string {
  const key = (process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY || '').trim();
  if (!key) {
    throw new BackendError(EXIT.AUTH, 'Set NVIDIA_API_KEY to use the NVIDIA NIM backend.', 'export NVIDIA_API_KEY=…');
  }
  return key;
}

export function createNimBackend(options: BackendOptions = {}): Backend {
  return createOpenAiCompatBackend(NIM_PRESET, options);
}
