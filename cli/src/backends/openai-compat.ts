/**
 * Shared OpenAI-compatible backend (TRD §7.3): one implementation, three
 * presets (nim, openai, openrouter). Speaks POST {base}/chat/completions
 * with Bearer auth; text is choices[0].message.content; usage is
 * prompt_tokens / completion_tokens. Key comes ONLY from the preset's env
 * vars (PRD R12 — never a command-line flag).
 *
 * Compatibility wrinkle handled here: newer OpenAI reasoning models reject
 * `max_tokens` (they want `max_completion_tokens`) and some also reject
 * `temperature`. On a 400 whose body mentions `max_completion_tokens`, the
 * request is retried once in that shape, without `temperature`.
 */

import { EXIT } from '../core/errors.js';
import { errorSnippet, postJsonWithRetry } from './http.js';
import { BackendError, type Backend, type BackendOptions, type CompletionRequest, type CompletionResult } from './types.js';

export interface OpenAiCompatPreset {
  /** Machine id (`--backend <id>`). */
  id: 'nim' | 'openai' | 'openrouter';
  /** Human name for error messages. */
  displayName: string;
  defaultBaseUrl: string;
  /** Env var overriding the base URL (self-hosted endpoints); undefined = fixed. */
  baseUrlEnv?: string;
  /** Env vars holding the API key, first set wins; the first is the hint name. */
  apiKeyEnvs: string[];
  defaultModel: string;
  /** Env var overriding the model. */
  modelEnv: string;
  /** Conservative input budget — varies per model, override with --ctx (Ollama) / --model. */
  inputBudgetTokens: number;
}

const TIMEOUT_MS = 120_000;

function peekApiKey(preset: OpenAiCompatPreset): string {
  for (const env of preset.apiKeyEnvs) {
    const key = (process.env[env] || '').trim();
    if (key) return key;
  }
  return '';
}

/** Fail fast BEFORE any network call — never a raw 401 stack trace. */
function requireApiKey(preset: OpenAiCompatPreset): string {
  const key = peekApiKey(preset);
  if (!key) {
    throw new BackendError(
      EXIT.AUTH,
      `Set ${preset.apiKeyEnvs[0]} to use the ${preset.displayName} backend.`,
      `export ${preset.apiKeyEnvs[0]}=…`
    );
  }
  return key;
}

interface ChatCompletionsResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string } | string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createOpenAiCompatBackend(preset: OpenAiCompatPreset, options: BackendOptions = {}): Backend {
  const model =
    options.model ||
    (preset.modelEnv ? (process.env[preset.modelEnv] || '').trim() : '') ||
    preset.defaultModel;
  const baseUrl = (
    (options.baseUrl ?? (preset.baseUrlEnv ? (process.env[preset.baseUrlEnv] || '').trim() : '')) ||
    preset.defaultBaseUrl
  ).replace(/\/+$/, '');

  const completeOnce = async (
    apiKey: string,
    req: CompletionRequest,
    signal: AbortSignal,
    shape: 'max_tokens' | 'max_completion_tokens'
  ): Promise<{ status: number; text: string }> => {
    const body: Record<string, unknown> =
      shape === 'max_tokens'
        ? {
            model,
            max_tokens: req.maxOutputTokens,
            temperature: req.temperature,
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.user },
            ],
          }
        : {
            model,
            max_completion_tokens: req.maxOutputTokens,
            // Newer reasoning models reject custom temperature too.
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.user },
            ],
          };
    return postJsonWithRetry(
      `${baseUrl}/chat/completions`,
      body,
      {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      TIMEOUT_MS,
      signal
    );
  };

  return {
    id: preset.id,
    model,
    isLocal: false,
    contextWindowTokens: preset.inputBudgetTokens,
    destination: new URL(baseUrl).host,

    async complete(req: CompletionRequest, signal: AbortSignal): Promise<CompletionResult> {
      const apiKey = requireApiKey(preset);
      let res;
      try {
        res = await completeOnce(apiKey, req, signal, 'max_tokens');
      } catch (err) {
        const status = (err as { status?: number }).status;
        const body = (err as { body?: string }).body ?? '';
        // OpenAI's newer reasoning models reject `max_tokens` — retry once in
        // the `max_completion_tokens` shape (no temperature) before giving up.
        if (status === 400 && /max_completion_tokens/i.test(body)) {
          try {
            res = await completeOnce(apiKey, req, signal, 'max_completion_tokens');
          } catch (retryErr) {
            throw toBackendError(preset, retryErr, baseUrl);
          }
        } else {
          throw toBackendError(preset, err, baseUrl);
        }
      }

      let data: ChatCompletionsResponse;
      try {
        data = JSON.parse(res.text) as ChatCompletionsResponse;
      } catch {
        throw new BackendError(EXIT.UNREACHABLE, `${preset.displayName} response was not a JSON object.`);
      }
      if (data.error) {
        const message =
          typeof data.error === 'string' ? data.error : data.error.message ?? JSON.stringify(data.error);
        throw new BackendError(EXIT.UNREACHABLE, `${preset.displayName} error: ${message}`);
      }
      const text = (data.choices?.[0]?.message?.content ?? '').trim();
      if (!text) throw new BackendError(EXIT.UNREACHABLE, `${preset.displayName} responded but contained no text content.`);
      return {
        text,
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
      };
    },

    async preflight(): Promise<{ ok: boolean; detail: string }> {
      const key = peekApiKey(preset);
      if (!key) {
        return { ok: false, detail: `${preset.apiKeyEnvs[0]} is not set (only needed for --backend ${preset.id})` };
      }
      return { ok: true, detail: `${preset.apiKeyEnvs[0]} is set (model ${model})` };
    },
  };
}

/** Maps a transport-layer failure to the backend error contract. */
function toBackendError(preset: OpenAiCompatPreset, err: unknown, baseUrl: string): BackendError {
  const status = (err as { status?: number }).status;
  const body = (err as { body?: string }).body ?? '';
  if (status === 401 || status === 403) {
    return new BackendError(
      EXIT.AUTH,
      `${preset.displayName} rejected the API key (HTTP ${status}).`,
      `check ${preset.apiKeyEnvs[0]}`
    );
  }
  if (status !== undefined) {
    return new BackendError(EXIT.UNREACHABLE, `${preset.displayName} API returned HTTP ${status}. Response: ${errorSnippet(body)}`);
  }
  return new BackendError(EXIT.UNREACHABLE, `Couldn't reach ${baseUrl} (${err instanceof Error ? err.message : String(err)}).`);
}
