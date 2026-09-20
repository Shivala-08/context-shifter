/**
 * Shared HTTP plumbing — plain fetch, no dependencies (TRD §3).
 * Cloud backends share the transport-retry policy (TRD §7.2): up to 2 retries
 * on 429/5xx with exponential backoff + jitter, honouring `retry-after`.
 * This is separate from the single *validation* retry in the pipeline.
 */

export interface PostResult {
  status: number;
  text: string;
  headers: Headers;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryable: boolean;
  readonly responseHeaders?: Headers;

  constructor(status: number, body: string, retryable: boolean, responseHeaders?: Headers) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.retryable = retryable;
    this.responseHeaders = responseHeaders;
  }
}

export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<PostResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  // An already-aborted signal never fires its abort event — propagate it now.
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (res.status !== 200) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new HttpError(res.status, text, retryable, res.headers);
    }
    return { status: res.status, text, headers: res.headers };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<PostResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    if (res.status !== 200) throw new HttpError(res.status, text, false);
    return { status: res.status, text, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

const MAX_TRANSPORT_RETRIES = 2;
const BASE_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST with transport retries on 429/5xx. Throws HttpError otherwise. */
export async function postJsonWithRetry(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<PostResult> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    try {
      return await postJson(url, body, headers, timeoutMs, signal);
    } catch (err) {
      const retryable = err instanceof HttpError && err.retryable;
      if (!retryable || attempt > MAX_TRANSPORT_RETRIES || signal?.aborted) throw err;
      const httpErr = err as HttpError;
      const retryAfter = Number(httpErr.responseHeaders?.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 250;
      await sleep(delay);
    }
  }
}

/** Extracts the usable message from an API error body. */
export function errorSnippet(body: string): string {
  if (!body) return '(no response body)';
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof json.error === 'string') return json.error.slice(0, 300);
    if (json.error?.message) return json.error.message.slice(0, 300);
  } catch {
    // not JSON — fall through
  }
  return body.slice(0, 300);
}
