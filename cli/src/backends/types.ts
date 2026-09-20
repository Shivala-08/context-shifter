/**
 * Backend interface (TRD §6.1). Backends do one thing: turn
 * {system, user} into {text, usage?}. Everything else — chunking, retries on
 * bad format, post-processing — lives in the pipeline so all backends behave
 * identically.
 */

import type { ExitCode } from '../core/errors.js';

export type BackendId = 'ollama' | 'anthropic' | 'nim';

export interface CompletionRequest {
  system: string;
  user: string;
  maxOutputTokens: number;
  temperature: number;
}

export interface CompletionResult {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface Backend {
  readonly id: BackendId;
  /** Resolved model id (flag > env > per-backend default) — surfaced by --json and doctor. */
  readonly model: string;
  /** Loopback host only — drives --offline (TRD §7.4). */
  readonly isLocal: boolean;
  /** Model-context size in tokens; the pipeline derives the input budget. */
  readonly contextWindowTokens: number;
  /** Human-named destination for warnings and the --offline error. */
  readonly destination: string;
  complete(req: CompletionRequest, signal: AbortSignal): Promise<CompletionResult>;
  /** Cheap reachability/config check used by `doctor`. */
  preflight(): Promise<{ ok: boolean; detail: string }>;
}

export interface BackendOptions {
  host?: string;
  model?: string;
  /** Ollama context-window override (--ctx). */
  ctx?: number;
  /** Cloud endpoint override (used by tests against a local mock server). */
  baseUrl?: string;
}

export class BackendError extends Error {
  readonly exitCode: ExitCode;
  readonly hint?: string;

  constructor(exitCode: ExitCode, message: string, hint?: string) {
    super(message);
    this.name = 'BackendError';
    this.exitCode = exitCode;
    this.hint = hint;
  }
}
