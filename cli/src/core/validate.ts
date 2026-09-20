/**
 * Card validation (TRD §9, PRD R4/R5) — reason codes shared with the Swift
 * fixtures in shared/fixtures/cards-invalid/ (see shared/card-spec.md):
 *
 *   MISSING_SECTION · EMPTY_SECTION · FABRICATED_URL · LEVEL_LIMIT
 *   NO_COMPRESSION (warning only)
 */

import { parseSections, REQUIRED_SECTIONS, todayStamp, type SectionName } from './card.js';
import type { Level } from './prompt.js';

/** URLs like https://… — stops at whitespace and markdown-safe delimiters. */
const URL_RE = /https?:\/\/[^\s<>()[\]"'`,;]+/g;

/** Strips trailing punctuation that a markdown bullet commonly attaches. */
function cleanUrl(url: string): string {
  return url.replace(/[).,;:!?.]+$/, '');
}

export function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text).matchAll(URL_RE)) {
    const u = cleanUrl(m[0]);
    if (u) out.push(u);
  }
  return out;
}

export type ReasonCode = 'MISSING_SECTION' | 'EMPTY_SECTION' | 'FABRICATED_URL' | 'LEVEL_LIMIT' | 'NO_COMPRESSION';

export interface ValidationProblem {
  code: ReasonCode;
  /** Human-readable detail; also what goes into {{REASONS}} on retry. */
  detail: string;
}

export interface ValidateOptions {
  /** Original (or redacted) conversation text — link fidelity is checked against it. */
  input: string;
  level: Level;
}

export interface ValidationResult {
  ok: boolean;
  problems: ValidationProblem[];
}

/** Cheap shape check: every required header present, in order. */
export function validateCard(text: string): boolean {
  let last = -1;
  for (const h of REQUIRED_HEADERS_ORDER) {
    const i = text.indexOf(h);
    if (i === -1) return false;
    if (i < last) return false;
    last = i;
  }
  return true;
}

const REQUIRED_HEADERS_ORDER: readonly string[] = REQUIRED_SECTIONS.map((s) => `## ${s}`);

function bulletCount(body: string): number {
  return body.split('\n').filter((l) => /^[ \t]*[-*•]\s+\S/.test(l)).length;
}

function sectionBodyEmpty(body: string): boolean {
  return body.replace(/```[\s\S]*?```/g, '').trim().length === 0;
}

/**
 * Full validation per shared/card-spec.md. Order of checks follows the spec
 * table; all applicable problems are collected (the retry prompt lists them).
 */
export function validateCardDetailed(card: string, opts: ValidateOptions): ValidationResult {
  const problems: ValidationProblem[] = [];

  // MISSING_SECTION — presence and order in one pass.
  const sections = parseSections(card);
  const byName = new Map<SectionName, string>();
  let lastIdx = -1;
  let inOrder = true;
  for (const name of REQUIRED_SECTIONS) {
    const idx = sections.findIndex((s) => s.name === name);
    if (idx === -1) {
      problems.push({ code: 'MISSING_SECTION', detail: `missing section "## ${name}"` });
      continue;
    }
    const section = sections[idx];
    if (!section) continue;
    byName.set(name, section.body);
    if (idx <= lastIdx) inOrder = false;
    lastIdx = idx;
  }
  if (!inOrder && problems.every((p) => p.code !== 'MISSING_SECTION')) {
    problems.push({ code: 'MISSING_SECTION', detail: 'sections are present but out of the required order' });
  }

  // EMPTY_SECTION — "None noted." and any non-empty body count as content.
  if (problems.every((p) => p.code !== 'MISSING_SECTION')) {
    for (const name of REQUIRED_SECTIONS) {
      const body = byName.get(name) ?? '';
      if (sectionBodyEmpty(body)) {
        problems.push({ code: 'EMPTY_SECTION', detail: `section "## ${name}" is empty (write "None noted." if there is nothing to report)` });
      }
    }
  }

  // FABRICATED_URL — every link under Resources & Links must be in the input.
  const linksBody = byName.get('Resources & Links');
  if (linksBody && linksBody.trim().length > 0 && !/^none noted\.?$/i.test(linksBody.trim())) {
    const inputUrls = new Set(extractUrls(opts.input).map((u) => u.toLowerCase()));
    const fabricated = extractUrls(linksBody).filter((u) => !inputUrls.has(u.toLowerCase()));
    if (fabricated.length > 0) {
      problems.push({
        code: 'FABRICATED_URL',
        detail: `URL(s) not present in the source conversation: ${fabricated.join(', ')} — copy links verbatim or omit them`,
      });
    }
  }

  // LEVEL_LIMIT — minimal: ≤2 bullets per section, Resources & Links exempt.
  if (opts.level === 'minimal' && problems.every((p) => p.code !== 'MISSING_SECTION')) {
    for (const name of REQUIRED_SECTIONS) {
      if (name === 'Resources & Links') continue;
      const body = byName.get(name) ?? '';
      const n = bulletCount(body);
      if (n > 2) {
        problems.push({ code: 'LEVEL_LIMIT', detail: `"## ${name}" has ${n} bullets — minimal level allows at most 2` });
      }
    }
  }

  // NO_COMPRESSION — warning only. Skipped for very short inputs.
  if (opts.input.trim().length >= 500 && card.length >= opts.input.length) {
    problems.push({ code: 'NO_COMPRESSION', detail: 'the card is not smaller than the input' });
  }

  const ok = !problems.some((p) => p.code !== 'NO_COMPRESSION');
  return { ok, problems };
}

/** Formats problems for the retry prompt's {{REASONS}} placeholder. */
export function formatReasons(problems: ValidationProblem[]): string {
  return problems.map((p) => `${p.code}: ${p.detail}`).join('; ');
}

// Kept as a re-export for API stability — the definition lives in card.ts
// (card.ts must not import validate.ts; see the comment there).
export { todayStamp };
