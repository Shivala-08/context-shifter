/**
 * Backend factory. Names match the PRD's `--backend` flag; every constructor
 * takes its own options shape, so the factory narrows per id.
 */

import { CliError, EXIT } from '../core/errors.js';
import { createAnthropicBackend } from './anthropic.js';
import { createNimBackend } from './nim.js';
import { createOllamaBackend } from './ollama.js';
import { createOpenAiBackend } from './openai.js';
import { createOpenRouterBackend } from './openrouter.js';
import type { Backend, BackendId } from './types.js';

export const BACKEND_IDS: readonly BackendId[] = ['ollama', 'anthropic', 'nim', 'openai', 'openrouter'];

export function createBackend(id: string, options: { host?: string; model?: string; ctx?: number } = {}): Backend {
  switch (id) {
    case 'ollama':
      return createOllamaBackend({ host: options.host, model: options.model, ctx: options.ctx });
    case 'anthropic':
      return createAnthropicBackend({ model: options.model });
    case 'nim':
      return createNimBackend({ model: options.model });
    case 'openai':
      return createOpenAiBackend({ model: options.model });
    case 'openrouter':
      return createOpenRouterBackend({ model: options.model });
    default:
      throw new CliError(EXIT.USAGE, `Unknown backend "${id}". Valid options: ${BACKEND_IDS.join(', ')}.`);
  }
}

export function resolveBackendId(flag?: string): BackendId {
  const fromEnv = process.env.CONTEXT_SHIFTER_BACKEND?.trim().toLowerCase();
  const id = (flag || fromEnv || 'ollama').toLowerCase();
  if (!BACKEND_IDS.includes(id as BackendId)) {
    throw new CliError(EXIT.USAGE, `Unknown backend "${id}". Valid options: ${BACKEND_IDS.join(', ')}.`);
  }
  return id as BackendId;
}
