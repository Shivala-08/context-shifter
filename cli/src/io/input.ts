/**
 * Input sources (PRD R1, TRD §10): file path, `-`, or piped stdin. A TTY
 * stdin gets an explicit paste prompt with the OS-correct EOF key instead of
 * hanging silently. A size guard protects against accidental huge pipes.
 */

import fs from 'node:fs';
import { CliError, EXIT } from '../core/errors.js';
import { decodeBytes, normalizeText } from './encoding.js';

export const DEFAULT_MAX_INPUT_BYTES = 10 * 1024 * 1024;

export interface ReadInputOptions {
  file?: string;
  maxBytes?: number;
  /** Paste-mode prompt sink (stderr in the CLI). */
  onError?: (line: string) => void;
}

function eofHint(): string {
  return process.platform === 'win32' ? 'Ctrl-Z, then Enter' : 'Ctrl-D';
}

function readStdinBytes(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk as Buffer));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', reject);
  });
}

/** Reads the conversation: file | stdin | TTY paste mode. Returns normalized text. */
export async function readInput(options: ReadInputOptions = {}): Promise<string> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_INPUT_BYTES;
  let bytes: Buffer;

  if (options.file && options.file !== '-') {
    try {
      bytes = fs.readFileSync(options.file);
    } catch (err) {
      throw new CliError(
        EXIT.USAGE,
        `Cannot read file "${options.file}": ${err instanceof Error ? err.message : String(err)}.`
      );
    }
  } else {
    if (process.stdin.isTTY) {
      // Interactive: ask for a paste instead of hanging silently (PRD R1).
      options.onError?.(`Paste the conversation, then press ${eofHint()}:`);
      bytes = await readStdinBytes();
    } else {
      bytes = await readStdinBytes();
    }
  }

  if (bytes.length > maxBytes) {
    throw new CliError(
      EXIT.USAGE,
      `Input is ${bytes.length} bytes — over the ${maxBytes} byte limit.`,
      'raise it with --max-input <bytes> if you really meant to.'
    );
  }

  const { text } = decodeBytes(bytes);
  const normalized = normalizeText(text);
  if (!normalized) {
    throw new CliError(
      EXIT.USAGE,
      'No input. Pipe a conversation in (pbpaste | context-shifter extract), pass a file, or paste one.',
      'see: context-shifter extract --help'
    );
  }
  return normalized;
}
