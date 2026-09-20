/**
 * `models` (PRD R14) — list locally installed Ollama models.
 */

import { EXIT, CliError } from '../core/errors.js';
import { listOllamaModels } from '../backends/ollama.js';

function humanSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? ` · ${gb.toFixed(1)} GB` : ` · ${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export async function runModels(host?: string): Promise<number> {
  let models;
  try {
    models = await listOllamaModels(host);
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(EXIT.UNREACHABLE, err instanceof Error ? err.message : String(err));
  }
  if (models.length === 0) {
    process.stdout.write('No Ollama models installed. Pull one with: ollama pull qwen3:8b\n');
    return EXIT.OK;
  }
  for (const m of models) {
    process.stdout.write(`${m.name}${humanSize(m.size)}\n`);
  }
  return EXIT.OK;
}
