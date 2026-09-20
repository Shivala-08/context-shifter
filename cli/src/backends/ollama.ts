/**
 * Ollama backend (default, local) — TRD §7.1.
 * POST /api/chat with stream:false and an explicit num_ctx: Ollama's default
 * window has historically been smaller than people assume and silently
 * truncates the prompt, producing cards that ignore the conversation start.
 * The app sets 8K for this reason; the CLI mirrors it.
 */

import { CliError, EXIT } from '../core/errors.js';
import { getJson, postJson } from './http.js';
import { BackendError, type Backend, type BackendOptions, type CompletionRequest, type CompletionResult } from './types.js';

export const NUM_CTX = 8192;
export const DEFAULT_HOST = 'http://127.0.0.1:11434';
export const DEFAULT_MODEL = 'qwen3:8b';
const TIMEOUT_MS = 120_000;

export function resolveHost(host?: string): string {
  let trimmed = String(host || process.env.OLLAMA_HOST || '').trim();
  if (!trimmed) trimmed = DEFAULT_HOST;
  while (trimmed.endsWith('/')) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

/** Loopback check on the RESOLVED host — a remote OLLAMA_HOST is not local (TRD §6.1). */
export function isLoopbackHost(host: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(host);
  } catch {
    return false;
  }
  const h = parsed.hostname.toLowerCase();
  return h === 'localhost' || h === '::1' || h === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

interface ChatResponse {
  message?: { content?: string };
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface TagsResponse {
  models?: Array<{ name?: string; model?: string; size?: number }>;
}

export function createOllamaBackend(options: BackendOptions = {}): Backend {
  const host = resolveHost(options.host);
  const model = options.model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;
  // Explicit num_ctx (TRD §7.1); --ctx raises it for bigger inputs.
  const numCtx = options.ctx ?? NUM_CTX;

  return {
    id: 'ollama',
    isLocal: isLoopbackHost(host),
    contextWindowTokens: numCtx,
    destination: host,

    async complete(req: CompletionRequest, signal: AbortSignal): Promise<CompletionResult> {
      const body = {
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        stream: false,
        // Thinking models (qwen3…) default to emitting <think> blocks we strip
        // anyway — skip generating them. Older servers ignore the field.
        think: false,
        keep_alive: '10m',
        options: {
          num_ctx: numCtx,
          num_predict: req.maxOutputTokens,
          temperature: req.temperature,
        },
      };

      let res;
      try {
        res = await postJson(`${host}/api/chat`, body, {}, TIMEOUT_MS, signal);
      } catch (err) {
        if (signal.aborted) throw err;
        // OOM on model load has a different fix than connection trouble —
        // surface it specifically, like the Swift app does.
        const httpErr = err as { status?: number; body?: string };
        const lower = (httpErr.body ?? '').toLowerCase();
        if (httpErr.status === 500 && (lower.includes('memory') || lower.includes('allocat'))) {
          throw new BackendError(
            EXIT.UNREACHABLE,
            'Ollama ran out of memory loading this model. Try a smaller model or close other apps.'
          );
        }
        if (httpErr.status === 404) {
          throw new BackendError(
            EXIT.UNREACHABLE,
            `Ollama doesn't have the model "${model}".`,
            `pull it with: ollama pull ${model}`
          );
        }
        if (httpErr.status !== undefined) {
          throw new BackendError(EXIT.UNREACHABLE, `Ollama returned HTTP ${httpErr.status}. Response: ${lower.slice(0, 300) || '(no response body)'}`);
        }
        throw unreachable(err, host, model);
      }

      let data: ChatResponse;
      try {
        data = JSON.parse(res.text) as ChatResponse;
      } catch {
        throw new BackendError(EXIT.UNREACHABLE, 'Ollama response was not a JSON object.');
      }
      if (typeof data.error === 'string') {
        throw new BackendError(EXIT.UNREACHABLE, `Ollama error: ${data.error}`);
      }
      const text = (data.message?.content ?? '').trim();
      if (!text) throw new BackendError(EXIT.UNREACHABLE, 'Ollama responded but contained no text content.');
      return {
        text,
        usage: {
          inputTokens: data.prompt_eval_count ?? 0,
          outputTokens: data.eval_count ?? 0,
        },
      };
    },

    async preflight(): Promise<{ ok: boolean; detail: string }> {
      try {
        const res = await getJson(`${host}/api/tags`, {}, 3_000);
        const data = JSON.parse(res.text) as TagsResponse;
        const names = (data.models ?? []).map((m) => m.model ?? m.name ?? '').filter(Boolean);
        return { ok: true, detail: names.length > 0 ? `${names.length} model(s) installed` : 'reachable, no models pulled' };
      } catch {
        return { ok: false, detail: `not reachable at ${host} — start it with: ollama serve` };
      }
    },
  };
}

function unreachable(err: unknown, host: string, model: string): BackendError {
  const reason =
    err instanceof Error && err.name === 'AbortError'
      ? 'request timed out'
      : err instanceof Error && err.cause && typeof err.cause === 'object' && 'code' in err.cause
        ? String((err.cause as { code: unknown }).code)
        : String(err instanceof Error ? err.message : err);
  return new BackendError(
    EXIT.UNREACHABLE,
    `Ollama isn't reachable at ${host} (${reason}).`,
    `start it with: ollama serve, and make sure the model is pulled: ollama pull ${model}`
  );
}

/** GET /api/tags — used by `models` and `doctor`. */
export async function listOllamaModels(host?: string): Promise<Array<{ name: string; size?: number }>> {
  const resolved = resolveHost(host);
  let res;
  try {
    res = await getJson(`${resolved}/api/tags`, {}, 5_000);
  } catch {
    throw new CliError(EXIT.UNREACHABLE, `Ollama isn't reachable at ${resolved}.`, 'start it with: ollama serve');
  }
  let data: TagsResponse;
  try {
    data = JSON.parse(res.text) as TagsResponse;
  } catch {
    throw new CliError(EXIT.UNREACHABLE, 'Ollama /api/tags response was not a JSON object.');
  }
  return (data.models ?? [])
    .map((m) => ({ name: m.model ?? m.name ?? '', size: m.size }))
    .filter((m) => m.name !== '');
}
