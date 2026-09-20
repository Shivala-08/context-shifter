/**
 * Chunking (TRD §8, PRD R7) — inputs bigger than the backend's input budget
 * are split on turn boundaries, packed greedily with a small overlap, then
 * merged. Local 8K windows make this the difference between working and not.
 */

import { estimateTokens } from './tokens.js';

/**
 * Input budget for one call (TRD §8.1):
 *   local:  (window − promptTokens − outputReserve − safetyMargin) × 0.8
 *   cloud:  declared input budget − promptTokens − safetyMargin
 */
export const OUTPUT_RESERVE = 1500;
export const SAFETY_MARGIN = 300;
/** chars/4 underestimates tokens for code, URLs and non-Latin scripts. */
const LOCAL_SAFETY_FACTOR = 0.8;

export function computeInputBudget(
  contextWindowTokens: number,
  systemPromptTokens: number,
  isLocal: boolean
): number {
  if (isLocal) {
    const raw = contextWindowTokens - systemPromptTokens - OUTPUT_RESERVE - SAFETY_MARGIN;
    return Math.max(200, Math.floor(raw * LOCAL_SAFETY_FACTOR));
  }
  return Math.max(200, contextWindowTokens - systemPromptTokens - SAFETY_MARGIN);
}

const SPEAKER_BOUNDARY_RE = /^(user|you|me|human|assistant|chatgpt|claude|gemini|ai)\s*[:>]/i;
const SPEAKER_ANY_RE = /^(user|you|me|human|assistant|chatgpt|claude|gemini|ai)\s*[:>]/im;

const FENCE_RE = /^\s*```/;

/** True when `text` contains an unbalanced number of code fences. */
function insideFence(text: string): boolean {
  const fences = text.split('\n').filter((l) => FENCE_RE.test(l)).length;
  return fences % 2 === 1;
}

export type SplitMode = 'speakers' | 'paragraphs' | 'lines' | 'single';

/**
 * Splits input into turn-sized units, preferring (in order): speaker labels,
 * blank-line paragraphs, lines. Never proposes a boundary inside a fenced
 * code block. Returns [units, mode].
 */
export function splitTurns(text: string): [string[], SplitMode] {
  const trimmed = text.trim();
  if (!trimmed) return [[], 'single'];

  // Speaker labels: boundaries before each labelled line (keeps labels attached).
  if (SPEAKER_ANY_RE.test(trimmed)) {
    const lines = trimmed.split('\n');
    const units: string[] = [];
    let current: string[] = [];
    for (const line of lines) {
      if (SPEAKER_BOUNDARY_RE.test(line) && current.length > 0 && !insideFence(current.join('\n'))) {
        units.push(current.join('\n').trim());
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) units.push(current.join('\n').trim());
    const clean = units.filter(Boolean);
    if (clean.length >= 2) return [clean, 'speakers'];
  }

  // Blank-line paragraphs, re-merged so code fences stay balanced.
  const paragraphs = trimmed.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= 2) {
    const merged: string[] = [];
    for (const p of paragraphs) {
      const prev = merged[merged.length - 1];
      if (prev !== undefined && insideFence(prev)) merged[merged.length - 1] = prev + '\n\n' + p;
      else merged.push(p);
    }
    if (merged.length >= 2) return [merged, 'paragraphs'];
  }

  // Lines as a last resort (fence-aware).
  const lines = trimmed.split('\n');
  const merged: string[] = [];
  for (const line of lines) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && insideFence(prev)) merged[merged.length - 1] = prev + '\n' + line;
    else merged.push(line);
  }
  if (merged.length >= 2) return [merged, 'lines'];

  return [[trimmed], 'single'];
}

export interface Chunk {
  text: string;
  /** 1-based index within the extraction. */
  index: number;
  total: number;
}

/**
 * Greedy-packs units into chunks of at most `budgetTokens`, starting each new
 * chunk with an overlap of the previous 1–2 turns (≤ 10% of budget) so
 * context isn't cut mid-thought (TRD §8.2).
 */
export function planChunks(text: string, budgetTokens: number): Chunk[] {
  const trimmed = text.trim();
  const [units] = splitTurns(trimmed);
  if (units.length === 0 || estimateTokens(trimmed) <= budgetTokens) {
    return [{ text: trimmed, index: 1, total: 1 }];
  }

  const overlapBudget = Math.floor(budgetTokens * 0.1);

  // Greedy pack.
  const packed: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  for (const unit of units) {
    const t = estimateTokens(unit);
    if (t > budgetTokens) {
      // A single oversized unit becomes its own chunk (never dropped).
      if (current.length > 0) {
        packed.push(current.join('\n\n'));
        current = [];
        currentTokens = 0;
      }
      packed.push(unit);
      continue;
    }
    if (currentTokens + t > budgetTokens && current.length > 0) {
      packed.push(current.join('\n\n'));
      current = [];
      currentTokens = 0;
    }
    current.push(unit);
    currentTokens += t;
  }
  if (current.length > 0) packed.push(current.join('\n\n'));

  // Second pass: prepend the last 1–2 turns of the previous chunk when they
  // fit the 10% overlap window.
  const withOverlap: string[] = [];
  for (let i = 0; i < packed.length; i++) {
    const chunk = packed[i] ?? '';
    if (i === 0) {
      withOverlap.push(chunk);
      continue;
    }
    const prevUnits = (packed[i - 1] ?? '').split('\n\n');
    const overlapParts: string[] = [];
    let overlapTokens = 0;
    for (let j = prevUnits.length - 1; j >= 0 && overlapParts.length < 2; j--) {
      const u = prevUnits[j] ?? '';
      const t = estimateTokens(u);
      if (t === 0 || overlapTokens + t > overlapBudget) break;
      overlapParts.unshift(u);
      overlapTokens += t;
    }
    withOverlap.push(overlapParts.length > 0 ? [...overlapParts, chunk].join('\n\n') : chunk);
  }

  return withOverlap.map((t, i) => ({ text: t, index: i + 1, total: withOverlap.length }));
}

/**
 * Groups partial cards so each group's concatenated size stays within
 * `budgetTokens` — enables recursive reduce when partials alone exceed the
 * budget (TRD §8.2 step 5).
 */
export function groupForMerge(partials: string[], budgetTokens: number): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;
  for (const p of partials) {
    const t = estimateTokens(p);
    if (current.length > 0 && currentTokens + t > budgetTokens) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(p);
    currentTokens += t;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
