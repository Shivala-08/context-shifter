/**
 * NVIDIA NIM backend (cloud, OpenAI-compatible) — TRD §7.3.
 * Key comes ONLY from NVIDIA_API_KEY (NVIDIA_NIM_API_KEY accepted as a legacy
 * alias from the pre-rename CLI). NIM_BASE_URL can point at a self-hosted NIM.
 */

import { EXIT } from '../core/errors.js';
import { errorSnippet, postJsonWithRetry } from './http.js';
import { BackendError, type Backend, type BackendOptions, type CompletionRequest, type CompletionResult } from './types.js';

export const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const DEFAULT_MODEL = 'meta/llama-3.1-8b-instruct';
/** Varies per model; override with --ctx at the CLI layer (TRD §7.3). */
export const INPUT_BUDGET_TOKENS = 24_000;
const TIMEOUT_MS = 120_000;

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

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string } | string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createNimBackend(options: BackendOptions = {}): Backend {
  const model = options.model || process.env.NVIDIA_NIM_MODEL || DEFAULT_MODEL;
  const baseUrl = options.baseUrl ?? resolveBaseUrl();

  return {
    id: 'nim',
    isLocal: false,
    contextWindowTokens: INPUT_BUDGET_TOKENS,
    destination: new URL(baseUrl).host,

    async complete(req: CompletionRequest, signal: AbortSignal): Promise<CompletionResult> {
      const apiKey = requireApiKey();
      let res;
      try {
        res = await postJsonWithRetry(
          `${baseUrl}/chat/completions`,
          {
            model,
            max_tokens: req.maxOutputTokens,
            temperature: req.temperature,
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.user },
            ],
          },
          {
            authorization: `Bearer ${apiKey}`,
            accept: 'application/json',
          },
          TIMEOUT_MS,
          signal
        );
      } catch (err) {
        const status = (err as { status?: number }).status;
        const body = (err as { body?: string }).body ?? '';
        if (status === 401 || status === 403) {
          throw new BackendError(EXIT.AUTH, `NVIDIA NIM rejected the API key (HTTP ${status}).`, 'check NVIDIA_API_KEY');
        }
        if (status !== undefined) {
          throw new BackendError(EXIT.UNREACHABLE, `NVIDIA NIM API returned HTTP ${status}. Response: ${errorSnippet(body)}`);
        }
        throw new BackendError(EXIT.UNREACHABLE, `Couldn't reach ${baseUrl} (${err instanceof Error ? err.message : String(err)}).`);
      }

      let data: ChatCompletionsResponse;
      try {
        data = JSON.parse(res.text) as ChatCompletionsResponse;
      } catch {
        throw new BackendError(EXIT.UNREACHABLE, 'NIM response was not a JSON object.');
      }
      if (data.error) {
        const message = typeof data.error === 'string' ? data.error : data.error.message ?? JSON.stringify(data.error);
        throw new BackendError(EXIT.UNREACHABLE, `NIM error: ${message}`);
      }
      const text = (data.choices?.[0]?.message?.content ?? '').trim();
      if (!text) throw new BackendError(EXIT.UNREACHABLE, 'NIM responded but contained no text content.');
      return {
        text,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
      };
    },

    async preflight(): Promise<{ ok: boolean; detail: string }> {
      const key = peekApiKey();
      if (!key) return { ok: false, detail: 'NVIDIA_API_KEY is not set (only needed for --backend nim)' };
      return { ok: true, detail: `NVIDIA_API_KEY is set (model ${model})` };
    },
  };
}

/** Non-throwing variant of requireApiKey for diagnostics. */
function peekApiKey(): string {
  return (process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY || '').trim();
}
