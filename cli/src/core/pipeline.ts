/**
 * Extraction pipeline (TRD §6):
 *   plan → backend call(s) [chunk+merge when over budget] → postprocess →
 *   validate → one retry → stats. Cloud map steps run at concurrency 3;
 *   local map steps run sequentially on purpose (one model instance).
 */

import { groupForMerge, computeInputBudget, planChunks, type Chunk } from './chunk.js';
import { normalizeCard } from './card.js';
import { CliError, EXIT } from './errors.js';
import {
  maxOutputTokensFor,
  mergeSystemPromptFor,
  retrySystemPromptFor,
  systemPromptFor,
  userMessage,
  type Level,
} from './prompt.js';
import { estimateTokens, reductionSummary } from './tokens.js';
import { formatReasons, validateCardDetailed, type ValidationProblem } from './validate.js';
import { VERSION } from '../version.js';
import type { Backend, CompletionResult } from '../backends/types.js';

export const CLOUD_MAP_CONCURRENCY = 3;
const TEMPERATURE = 0.1;

export interface PipelineOptions {
  input: string;
  level: Level;
  backend: Backend;
  /** Progress reporter (stderr); receives lines like "chunk 2/5 …". */
  onProgress?: (line: string) => void;
  signal?: AbortSignal;
}

export interface PipelineResult {
  card: string;
  /** True when the final card passed every hard validation rule. */
  valid: boolean;
  problems: ValidationProblem[];
  warnings: string[];
  statsLine: string;
  usage?: { inputTokens: number; outputTokens: number };
  chunked: boolean;
  chunks: number;
  version: string;
}

async function complete(backend: Backend, system: string, user: string, maxOutputTokens: number, temperature: number, signal?: AbortSignal): Promise<CompletionResult> {
  return backend.complete({ system, user, maxOutputTokens, temperature }, signal ?? new AbortController().signal);
}

async function mapChunk(
  backend: Backend,
  chunk: Chunk,
  signal?: AbortSignal
): Promise<string> {
  const system =
    systemPromptFor('full') +
    `\n\nThis is part ${chunk.index} of ${chunk.total} of one longer conversation, in chronological order. Extract a partial context card for THIS part only; later parts continue the story.`;
  const res = await complete(backend, system, userMessage(chunk.text), maxOutputTokensFor('full'), TEMPERATURE, signal);
  return normalizeCard(res.text);
}

async function reducePartials(
  backend: Backend,
  partials: string[],
  level: Level,
  budgetTokens: number,
  onProgress?: (line: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const groups = groupForMerge(partials, budgetTokens);
  // One group → a single merge call. All-singleton groups (every partial fits
  // alone but not together) can't be split further — force one merge of
  // everything, otherwise the recursion would ping-pong forever.
  const canSplit = groups.length > 1 && groups.length < partials.length;
  if (!canSplit) {
    const user =
      `Merge the following ${partials.length} partial context card(s) into ONE final context card at the requested compression level:\n\n` +
      partials.map((p, i) => `--- Partial card ${i + 1} of ${partials.length} ---\n${p}`).join('\n\n');
    const res = await complete(backend, mergeSystemPromptFor(level), user, maxOutputTokensFor(level), TEMPERATURE, signal);
    return normalizeCard(res.text);
  }
  // Partials alone exceed the budget — reduce each group, then merge again.
  // Each recursion level strictly shrinks the number of cards, so this ends.
  onProgress?.(`merging ${groups.length} groups of partial cards…`);
  const groupCards: string[] = [];
  for (const group of groups) {
    groupCards.push(
      await reducePartials(backend, group, level, budgetTokens, onProgress, signal)
    );
  }
  return reducePartials(backend, groupCards, level, budgetTokens, onProgress, signal);
}

export async function runExtraction(opts: PipelineOptions): Promise<PipelineResult> {
  const { input, level, backend, onProgress, signal } = opts;
  const warnings: string[] = [];

  const systemTokens = estimateTokens(systemPromptFor(level));
  const budget = computeInputBudget(backend.contextWindowTokens, systemTokens, backend.isLocal);

  // Cloud egress notice (TRD §12) — one line, on stderr, naming the host.
  if (!backend.isLocal) {
    onProgress?.(`sending the conversation to ${backend.destination} (cloud backend)`);
  }

  let rawCard: string;
  let chunked = false;
  let chunkCount = 1;
  let usage: CompletionResult['usage'] | undefined;

  if (estimateTokens(input) <= budget) {
    const res = await complete(backend, systemPromptFor(level), userMessage(input), maxOutputTokensFor(level), TEMPERATURE, signal);
    usage = res.usage;
    rawCard = normalizeCard(res.text);
  } else {
    const chunks = planChunks(input, budget);
    chunkCount = chunks.length;
    // Borderline inputs can exceed the budget on raw estimate yet pack into a
    // single chunk once separator overhead is dropped — treat those as the
    // single-call path so we don't pay a pointless merge round-trip.
    chunked = chunks.length > 1;
    if (!chunked) {
      const res = await complete(backend, systemPromptFor(level), userMessage(input), maxOutputTokensFor(level), TEMPERATURE, signal);
      usage = res.usage;
      rawCard = normalizeCard(res.text);
    } else {
    onProgress?.(`input exceeds the ${backend.id} input budget — extracting in ${chunks.length} chunk(s)…`);

    let partials: string[];
    if (backend.isLocal) {
      partials = [];
      for (const chunk of chunks) {
        onProgress?.(`chunk ${chunk.index}/${chunk.total} …`);
        partials.push(await mapChunk(backend, chunk, signal));
      }
    } else {
      partials = new Array(chunks.length);
      let next = 0;
      const workers = Array.from({ length: Math.min(CLOUD_MAP_CONCURRENCY, chunks.length) }, async () => {
        while (next < chunks.length) {
          const idx = next++;
          onProgress?.(`chunk ${idx + 1}/${chunks.length} …`);
          partials[idx] = await mapChunk(backend, chunks[idx] ?? { text: '', index: 0, total: 0 }, signal);
        }
      });
      await Promise.all(workers);
    }

    onProgress?.('merging partial cards…');
    rawCard = await reducePartials(backend, partials, level, budget, onProgress, signal);
    }
  }

  // Validation + one retry (PRD R4). Link fidelity checks against the
  // ENTIRE original input, not a chunk (TRD §8.2 step 7).
  let verdict = validateCardDetailed(rawCard, { input, level });
  if (!verdict.ok) {
    onProgress?.('card failed validation — retrying once with the failure reasons…');
    const retrySystem = retrySystemPromptFor(formatReasons(verdict.problems));
    const res = await complete(backend, retrySystem, userMessage(input), maxOutputTokensFor(level), 0, signal);
    usage = usage ?? res.usage;
    rawCard = normalizeCard(res.text);
    verdict = validateCardDetailed(rawCard, { input, level });
  }

  const card = rawCard;
  if (!verdict.ok) {
    warnings.push(
      'This card failed format validation even after one retry (' +
        verdict.problems.map((p) => p.code).join(', ') +
        ') — review before using.'
    );
  }
  for (const problem of verdict.problems) {
    if (problem.code === 'NO_COMPRESSION') warnings.push(problem.detail);
  }

  const statsLine = reductionSummary(input, card, usage);

  return {
    card,
    valid: verdict.ok,
    problems: verdict.problems,
    warnings,
    statsLine,
    usage,
    chunked,
    chunks: chunkCount,
    version: VERSION,
  };
}

/** Maps a pipeline failure to the CLI's exit-code contract. */
export function pipelineError(err: unknown): CliError {
  if (err instanceof CliError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new CliError(EXIT.UNEXPECTED, message);
}
