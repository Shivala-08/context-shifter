/**
 * `extract` (PRD R1–R8, R13, R15, R16) — the 80% command. Card to stdout,
 * everything else to stderr, exit codes per TRD §4.5.
 */

import fs from 'node:fs';
import { copyToClipboard } from '../io/clipboard.js';
import { readInput } from '../io/input.js';
import { CliError, EXIT } from '../core/errors.js';
import { runExtraction } from '../core/pipeline.js';
import { isLevel, type Level } from '../core/prompt.js';
import type { Backend } from '../backends/types.js';

export interface ExtractOptions {
  file?: string;
  level: string;
  backend: Backend;
  offline: boolean;
  quiet: boolean;
  copy: boolean;
  out?: string;
  maxInputBytes?: number;
  signal?: AbortSignal;
}

function stderr(line: string): void {
  process.stderr.write(line + '\n');
}

/** --offline refuses any non-loopback backend BEFORE any network I/O (PRD R13). */
export function assertOfflineAllowed(backend: Backend, offline: boolean): void {
  if (offline && !backend.isLocal) {
    throw new CliError(
      EXIT.USAGE,
      `--offline is set but the ${backend.id} backend would send data to ${backend.destination}.`,
      'drop --offline, or use the local Ollama backend (--backend ollama).'
    );
  }
}

export async function runExtract(options: ExtractOptions): Promise<number> {
  if (!isLevel(options.level)) {
    throw new CliError(EXIT.USAGE, `Invalid --level "${options.level}". Valid: full, balanced, minimal.`);
  }
  const level: Level = options.level;
  assertOfflineAllowed(options.backend, options.offline);

  const onProgress = options.quiet ? undefined : stderr;
  const warnings: string[] = [];
  const onWarning = (line: string) => {
    warnings.push(line);
    stderr(`warning: ${line}`);
  };

  const input = await readInput({
    file: options.file,
    maxBytes: options.maxInputBytes,
    onError: options.quiet ? undefined : stderr,
  });

  const result = await runExtraction({
    input,
    level,
    backend: options.backend,
    onProgress,
    signal: options.signal,
  });

  for (const w of result.warnings) onWarning(w);

  // Output: stdout stays the card only (TRD §4.4).
  process.stdout.write(result.card + '\n');

  if (options.out) {
    try {
      fs.writeFileSync(options.out, result.card + '\n', 'utf8');
      onProgress?.(`wrote ${options.out}`);
    } catch (err) {
      throw new CliError(
        EXIT.USAGE,
        `Cannot write "${options.out}": ${err instanceof Error ? err.message : String(err)}.`
      );
    }
  }

  if (options.copy) {
    const ok = await copyToClipboard(result.card + '\n', onWarning);
    if (ok) onProgress?.('copied to clipboard');
  }

  if (!options.quiet && result.statsLine) {
    stderr(result.statsLine + (result.chunked ? ` · ${result.chunks} chunks merged` : ''));
  }

  // R4: never silently pass a malformed card — printed + warned + exit 5.
  if (!result.valid) return EXIT.VALIDATION;
  return EXIT.OK;
}
