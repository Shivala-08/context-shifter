/**
 * Anthropic backend (cloud) — TRD §7.2. Key comes ONLY from ANTHROPIC_API_KEY
 * (PRD R12: keys are never command-line flags — shell history / `ps` leakage).
 */

import { EXIT } from '../core/errors.js';
import { errorSnippet, postJsonWithRetry } from './http.js';
import { BackendError, type Backend, type BackendOptions, type CompletionRequest, type CompletionResult } from './types.js';

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
/** Conservative input budget, well under the model's real window (TRD §7.2). */
export const INPUT_BUDGET_TOKENS = 100_000;
const TIMEOUT_MS = 120_000;

export function requireApiKey(): string {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) {
    // Fail fast BEFORE any network call — never a raw 401 stack trace.
    throw new BackendError(EXIT.AUTH, 'Set ANTHROPIC_API_KEY to use the Anthropic backend.', 'export ANTHROPIC_API_KEY=…');
  }
  return key;
}

interface MessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function createAnthropicBackend(options: BackendOptions = {}): Backend {
  const model = options.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const apiUrl = options.baseUrl ?? API_URL;

  return {
    id: 'anthropic',
    model,
    isLocal: false,
    contextWindowTokens: INPUT_BUDGET_TOKENS,
    destination: 'api.anthropic.com',

    async complete(req: CompletionRequest, signal: AbortSignal): Promise<CompletionResult> {
      const apiKey = requireApiKey();
      let res;
      try {
        res = await postJsonWithRetry(
          apiUrl,
          {
            model,
            max_tokens: req.maxOutputTokens,
            temperature: req.temperature,
            system: req.system,
            messages: [{ role: 'user', content: req.user }],
          },
          {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          TIMEOUT_MS,
          signal
        );
      } catch (err) {
        const status = (err as { status?: number }).status;
        const body = (err as { body?: string }).body ?? '';
        if (status === 401 || status === 403) {
          throw new BackendError(EXIT.AUTH, `Anthropic rejected the API key (HTTP ${status}).`, 'check ANTHROPIC_API_KEY');
        }
        if (status !== undefined) {
          throw new BackendError(EXIT.UNREACHABLE, `Anthropic API returned HTTP ${status}. Response: ${errorSnippet(body)}`);
        }
        throw new BackendError(EXIT.UNREACHABLE, `Couldn't reach api.anthropic.com (${err instanceof Error ? err.message : String(err)}).`);
      }

      let data: MessagesResponse;
      try {
        data = JSON.parse(res.text) as MessagesResponse;
      } catch {
        throw new BackendError(EXIT.UNREACHABLE, 'Anthropic response was not a JSON object.');
      }
      if (data.error) {
        throw new BackendError(EXIT.UNREACHABLE, `Anthropic error: ${data.error.message ?? 'unknown API error'}`);
      }
      const joined = (data.content ?? [])
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => (b.text ?? '').trim())
        .filter(Boolean)
        .join('\n');
      if (!joined) throw new BackendError(EXIT.UNREACHABLE, 'Anthropic API responded but contained no text content.');
      return {
        text: joined,
        usage: {
          inputTokens: data.usage?.input_tokens ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
        },
      };
    },

    async preflight(): Promise<{ ok: boolean; detail: string }> {
      const key = (process.env.ANTHROPIC_API_KEY || '').trim();
      if (!key) return { ok: false, detail: 'ANTHROPIC_API_KEY is not set (only needed for --backend anthropic)' };
      return { ok: true, detail: `ANTHROPIC_API_KEY is set (model ${model})` };
    },
  };
}
