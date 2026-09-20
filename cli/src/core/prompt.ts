/**
 * Loads the generated extraction prompt (cli/prompts/extraction-prompt.md,
 * produced by scripts/sync-prompt.mjs from shared/extraction-prompt.md) and
 * parses its front matter and @block markers (TRD §5.1).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CliError, EXIT } from './errors.js';
import { findPackageRoot } from '../version.js';

export type Level = 'full' | 'balanced' | 'minimal';

export const LEVELS: readonly Level[] = ['full', 'balanced', 'minimal'];

export function isLevel(value: string): value is Level {
  return (LEVELS as readonly string[]).includes(value);
}

const thisDir = path.dirname(fileURLToPath(import.meta.url));
// Walks up past dist/ or .build/ to the package root (cli/).
const packageRoot = findPackageRoot(thisDir);

interface ParsedPrompt {
  specVersion: number;
  blocks: Map<string, string>;
}

let cached: ParsedPrompt | undefined;

function parsePromptFile(text: string): ParsedPrompt {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const fmBody = fm?.[1];
  if (fmBody === undefined) throw new Error('Extraction prompt has no YAML front matter.');
  const specMatch = /^spec_version:\s*(\d+)\s*$/m.exec(fmBody);
  const specVersionText = specMatch?.[1];
  if (specVersionText === undefined) throw new Error('Extraction prompt front matter is missing spec_version.');

  const marker = /<!--\s*@block ([\w:.-]+)\s*-->/g;
  const blocks = new Map<string, string>();
  const marks = [...text.matchAll(marker)];
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const name = mark?.[1];
    if (!mark || name === undefined) continue;
    const next = marks[i + 1];
    const start = (mark.index ?? 0) + (mark[0] ?? '').length;
    const end = next ? (next.index ?? text.length) : text.length;
    const body = text.slice(start, end).trim();
    if (body) blocks.set(name, body);
  }
  if (blocks.size === 0) throw new Error('Extraction prompt contains no @block markers.');
  return { specVersion: Number(specVersionText), blocks };
}

/** Loads (and caches) the prompt. Prefers prompts/, falls back to ../shared/ for dev. */
function loadPrompt(): ParsedPrompt {
  if (cached) return cached;
  const candidates = [
    path.join(packageRoot, 'prompts', 'extraction-prompt.md'),
    path.join(packageRoot, '..', 'shared', 'extraction-prompt.md'),
  ];
  for (const file of candidates) {
    try {
      cached = parsePromptFile(fs.readFileSync(file, 'utf8'));
      return cached;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  throw new Error(
    `Extraction prompt not found (tried: ${candidates.join(', ')}). Run \`npm run sync-prompt\` inside cli/.`
  );
}

/** CARD_SPEC_VERSION from the prompt's front matter (TRD §14). */
export function cardSpecVersion(): number {
  return loadPrompt().specVersion;
}

function block(name: string): string {
  const b = loadPrompt().blocks.get(name);
  if (!b) throw new Error(`Extraction prompt is missing the "@block ${name}" block — regenerate with \`npm run sync-prompt\`.`);
  return b;
}

/** The per-level hard output cap — mirrors CompressionLevel.maxOutputTokens in the Swift app. */
export function maxOutputTokensFor(level: Level): number {
  switch (level) {
    case 'full':
      return 2048;
    case 'balanced':
      return 1024;
    case 'minimal':
      return 512;
  }
}

/** System prompt for an extraction call: base rules + the level's rules. */
export function systemPromptFor(level: Level): string {
  return `${block('system')}\n\n${block(`level:${level}`)}`;
}

/** System prompt for the chunk-merge reduce step at the requested level. */
export function mergeSystemPromptFor(level: Level): string {
  return `${block('merge')}\n\n${block(`level:${level}`)}`;
}

/** System prompt for the single validation retry, with {{REASONS}} filled in. */
export function retrySystemPromptFor(reasons: string): string {
  const base = block('system');
  const retry = block('retry').replace('{{REASONS}}', reasons);
  return `${base}\n\n${retry}`;
}

/** Standard user message wrapping the (possibly partial) conversation text. */
export function userMessage(conversation: string): string {
  return 'Here is the conversation to extract from:\n\n' + conversation;
}

/** CLI-level guard: refuses to run without a loadable prompt. */
export function requirePromptLoaded(): void {
  try {
    loadPrompt();
  } catch (err) {
    throw new CliError(EXIT.UNEXPECTED, (err as Error).message);
  }
}
