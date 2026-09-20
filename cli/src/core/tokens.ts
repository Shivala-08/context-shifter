/**
 * Token accounting (PRD R6) — identical heuristics to the Swift app's
 * CompressionStats in Sources/ContextTransfer/ExtractionBackend.swift:
 * ~4 chars/token, "18400" → "18.4k", "18.4k → 2.1k tokens · 89% smaller".
 */

export function estimateTokens(text: string): number {
  return Math.floor(text.length / 4);
}

/** "18400" → "18.4k"; below 1000 stays an integer string. */
export function compactTokenCount(tokens: number): string {
  return tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'k' : String(tokens);
}

export interface UsageCounts {
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Builds the stderr stats line, preferring real API usage for the card size
 * and falling back to the chars/4 heuristic (same as the app).
 * Empty string for degenerate inputs — matches CompressionStats.summary.
 */
export function reductionSummary(originalText: string, cardText: string, usage?: UsageCounts): string {
  const originalTokens = estimateTokens(originalText);
  if (originalTokens <= 0) return '';
  const compressedTokens =
    usage && typeof usage.outputTokens === 'number' && usage.outputTokens > 0
      ? usage.outputTokens
      : estimateTokens(cardText);
  const reduction = 1 - compressedTokens / originalTokens;
  const pct = Math.round(reduction * 100);
  const pctText = pct > 0 ? ` · ${pct}% smaller` : ' (no reduction)';
  return `${compactTokenCount(originalTokens)} → ${compactTokenCount(compressedTokens)} tokens${pctText}`;
}
