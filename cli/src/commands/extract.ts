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
import { buildJsonOutput, serializeJsonOutput } from '../core/jsonout.js';
import { describeMatches, findSecrets, redactSecrets, type SecretMatches } from '../core/redact.js';
import { parseExport, type ExportFormat } from '../parsers/index.js';
import type { Backend } from '../backends/types.js';

export interface ExtractOptions {
  file?: string;
  level: string;
  backend: Backend;
  offline: boolean;
  quiet: boolean;
  copy: boolean;
  out?: string;
  /** --json: structured object to stdout instead of the markdown card (PRD R17). */
  json: boolean;
  /** --redact: scrub obvious secrets before anything is sent (PRD R18). */
  redact: boolean;
  /** --from: parse an official export into a transcript first (PRD R19). */
  from?: ExportFormat;
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

  let input = await readInput({
    file: options.file,
    maxBytes: options.maxInputBytes,
    onError: options.quiet ? undefined : stderr,
  });

  // --from (PRD R19): export JSON → plain transcript before anything else.
  if (options.from) {
    const parsed = parseExport(options.from, input);
    input = parsed.transcript;
    for (const w of parsed.warnings) onWarning(w);
    onProgress?.(`parsed ${options.from} export.`);
  }

  // --redact (PRD R18): scrub before anything leaves the process. Link
  // fidelity runs against this same (redacted) text downstream, so redaction
  // can't cause false validation failures (TRD §12).
  let redaction: { applied: boolean; matches: SecretMatches[] } | undefined;
  if (options.redact) {
    const scrubbed = redactSecrets(input);
    input = scrubbed.text;
    const total = scrubbed.matches.reduce((n, m) => n + m.count, 0);
    redaction = { applied: true, matches: scrubbed.matches };
    if (total > 0) {
      onProgress?.(`redacted ${total} potential secret(s) (${describeMatches(scrubbed.matches)}) before sending.`);
    }
  } else if (!options.backend.isLocal) {
    // Cloud without --redact: warn, never block (PRD R18).
    const found = findSecrets(input);
    if (found.length > 0) {
      const total = found.reduce((n, m) => n + m.count, 0);
      onWarning(
        `the input looks like it contains ${total} potential secret(s) (${describeMatches(found)}) and would go to ${options.backend.destination}. Use --redact to scrub them.`
      );
    }
  }

  const result = await runExtraction({
    input,
    level,
    backend: options.backend,
    onProgress,
    signal: options.signal,
  });

  for (const w of result.warnings) onWarning(w);

  // Output: stdout carries the card — or the JSON object with --json (TRD §4.4).
  if (options.json) {
    process.stdout.write(
      serializeJsonOutput(
        buildJsonOutput(result, {
          backend: options.backend.id,
          model: options.backend.model,
          level,
          ...(redaction ? { redaction } : {}),
        })
      )
    );
  } else {
    process.stdout.write(result.card + '\n');
  }

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
