/**
 * `--json` output (PRD R17) — a structured object alongside the markdown:
 * sections as arrays, stats, backend, model, spec_version. stdout carries
 * ONLY this JSON when the flag is set; `--out`/`--copy` still operate on the
 * markdown card.
 */

import { parseSections, type SectionName } from './card.js';
import { estimateTokens, compactTokenCount } from './tokens.js';
import { cardSpecVersion } from './prompt.js';
import type { Level } from './prompt.js';
import { VERSION } from '../version.js';
import type { BackendId } from '../backends/types.js';
import type { PipelineResult } from './pipeline.js';
import type { ValidationProblem } from './validate.js';
import type { SecretMatches } from './redact.js';

export interface JsonOutputMeta {
  backend: BackendId;
  model: string;
  level: Level;
  /** Present only when --redact ran. */
  redaction?: { applied: boolean; matches: SecretMatches[] };
}

export interface JsonOutput {
  spec_version: number;
  cli_version: string;
  captured_on: string;
  captured_at: string;
  backend: string;
  model: string;
  level: Level;
  chunked: boolean;
  chunks: number;
  card: string;
  sections: Partial<Record<SectionName, string[]>>;
  stats: {
    original_tokens: number;
    card_tokens: number;
    reduction_percent: number | null;
    summary: string;
  };
  valid: boolean;
  problems: Array<{ code: string; detail: string }>;
  warnings: string[];
  redacted?: { applied: boolean; matches: SecretMatches[] };
}

/** "Captured on: 2026-09-20" → "2026-09-20" (falls back to today's stamp). */
function capturedOnFromCard(card: string): string {
  const match = /^Captured on:\s*(.+?)\s*$/im.exec(card);
  return match?.[1] ?? '';
}

export function buildJsonOutput(result: PipelineResult, meta: JsonOutputMeta): JsonOutput {
  const sections: Partial<Record<SectionName, string[]>> = {};
  for (const section of parseSections(result.card)) {
    sections[section.name] = section.body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const originalTokens = result.originalTokens;
  const cardTokens =
    result.usage && result.usage.outputTokens > 0
      ? result.usage.outputTokens
      : estimateTokens(result.card);
  const reduction =
    originalTokens > 0 ? Math.round((1 - cardTokens / originalTokens) * 100) : null;

  return {
    spec_version: cardSpecVersion(),
    cli_version: VERSION,
    captured_on: capturedOnFromCard(result.card),
    captured_at: new Date().toISOString(),
    backend: meta.backend,
    model: meta.model,
    level: meta.level,
    chunked: result.chunked,
    chunks: result.chunks,
    card: result.card,
    sections,
    stats: {
      original_tokens: originalTokens,
      card_tokens: cardTokens,
      reduction_percent: reduction,
      summary: result.statsLine,
    },
    valid: result.valid,
    problems: result.problems.map((p: ValidationProblem) => ({ code: p.code, detail: p.detail })),
    warnings: result.warnings,
    ...(meta.redaction ? { redacted: meta.redaction } : {}),
  };
}

/** Stable, diff-friendly serialization: two-space indent, trailing newline. */
export function serializeJsonOutput(output: JsonOutput): string {
  return JSON.stringify(output, null, 2) + '\n';
}
