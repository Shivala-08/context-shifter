/**
 * Card post-processing (TRD §9 "Post-processing") — turn a raw model response
 * into a spec-shaped card before validation:
 *  - strip <think> reasoning blocks and any wrapping code fence
 *  - strip preamble ("Here's your context card…") and postamble
 *  - drop any model-produced "Captured on" line and stamp our own (ISO date, local)
 *  - normalise known headings to level 2
 */

/**
 * Local ISO date stamp for the "Captured on" line. Lives here — not in
 * validate.ts — because card.ts must not depend on validate.ts (the validator
 * imports the section list from this module; a cycle would crash on startup
 * depending on module evaluation order).
 */
export function todayStamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Shared strip of <think>…</think> reasoning blocks (qwen3 et al). */
export function stripThinkBlocks(text: string): string {
  // [\s\S]*? instead of the `s` regex flag — keeps the regex ES2018-safe.
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
    .trim();
}

export const REQUIRED_SECTIONS = [
  'Goal',
  'Key Decisions',
  'Constraints & Preferences',
  'Current State',
  'Resources & Links',
  'Open Questions',
] as const;

export type SectionName = (typeof REQUIRED_SECTIONS)[number];

/** "## Goal" … in spec order. */
export const REQUIRED_HEADERS: readonly string[] = REQUIRED_SECTIONS.map((s) => `## ${s}`);

const SECTION_ALTERNATION = REQUIRED_SECTIONS.map((s) => s.replace(/[&]/g, '\\&')).join('|');

function stripWrappingFence(text: string): string {
  let t = text.trim();
  if (!t.startsWith('```')) return t;
  const firstNewline = t.indexOf('\n');
  if (firstNewline === -1) return '';
  t = t.slice(firstNewline + 1);
  if (t.trimEnd().endsWith('```')) t = t.trimEnd().slice(0, -3);
  return t.trim();
}

function normalizeHeadings(text: string): string {
  // Any heading level (or bold pseudo-heading) naming a known section → "## Name".
  const re = new RegExp(`^#{1,6}\\s*(${SECTION_ALTERNATION})\\s*$`, 'gm');
  const bold = new RegExp(`^\\*\\*(${SECTION_ALTERNATION})\\*\\*\\s*$`, 'gm');
  return text.replace(re, '## $1').replace(bold, '## $1');
}

function findCardStart(text: string): number {
  const headerIdx = text.search(/^##\s/m);
  const captureIdx = text.search(/^Captured on:/im);
  if (headerIdx === -1 && captureIdx === -1) return 0;
  if (headerIdx === -1) return captureIdx;
  if (captureIdx === -1) return headerIdx;
  return Math.min(headerIdx, captureIdx);
}

/**
 * Post-processes one raw model response into card form.
 * The result is NOT guaranteed valid — run validateCardDetailed on it.
 */
export function normalizeCard(raw: string): string {
  let t = stripThinkBlocks(String(raw));
  t = stripWrappingFence(t);
  const start = findCardStart(t);
  if (start > 0) t = t.slice(start);

  // Drop the model's own "Captured on" line if it emitted one — we stamp ours.
  const capLine = /^Captured on:.*(?:\n|$)/i;
  if (/^Captured on:/i.test(t)) t = t.replace(capLine, '');
  t = t.trim();

  t = normalizeHeadings(t);

  if (!t) return `Captured on: ${todayStamp()}\n\nNone noted.`;
  return `Captured on: ${todayStamp()}\n\n${t}`;
}

export interface ParsedSection {
  header: string;
  name: SectionName;
  body: string;
}

/**
 * Splits a (normalized) card into its sections in the order they appear.
 * Content before the first header (the "Captured on" stamp) is ignored.
 */
export function parseSections(card: string): ParsedSection[] {
  const lines = card.split('\n');
  const sections: ParsedSection[] = [];
  let current: { header: string; name: SectionName; body: string[] } | undefined;
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)?.[1];
    if (heading !== undefined && (REQUIRED_SECTIONS as readonly string[]).includes(heading)) {
      if (current) sections.push({ ...current, body: current.body.join('\n') });
      current = { header: `## ${heading}`, name: heading as SectionName, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push({ ...current, body: current.body.join('\n') });
  return sections;
}
