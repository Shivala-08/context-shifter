/**
 * Secret redaction (PRD R18, TRD §12) — scrubs obvious secrets from the
 * input before anything is sent, replacing each match with `[REDACTED:type]`.
 * Two consumers:
 *  - `--redact` on any backend: replace before the pipeline runs (link
 *    fidelity then checks against the redacted text, so redaction can't
 *    cause false validation failures).
 *  - cloud backends WITHOUT `--redact`: scan only, warn on stderr.
 * Patterns are ordered most-specific first (sk-ant-… before the generic sk-…).
 */

export interface RedactionRule {
  /** Replacement label: `[REDACTED:<type>]`. */
  readonly type: string;
  /** Pattern source (no flags); compiled with the `g` flag per scan. */
  readonly source: string;
}

export const REDACTION_RULES: readonly RedactionRule[] = [
  // PEM private key blocks, e.g. "-----BEGIN RSA PRIVATE KEY-----"
  { type: 'private-key', source: '-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----' },
  // Anthropic keys (before the generic sk- rule)
  { type: 'anthropic-key', source: '\\bsk-ant-[A-Za-z0-9_-]{20,}\\b' },
  // NVIDIA NIM keys
  { type: 'nvidia-key', source: '\\bnvapi-[A-Za-z0-9_-]{20,}\\b' },
  // GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_ + fine-grained github_pat_
  { type: 'github-token', source: '\\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\\b' },
  // Slack tokens: xoxb/xoxa/xoxp/xoxr/xoxs
  { type: 'slack-token', source: '\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b' },
  // AWS access key IDs
  { type: 'aws-key', source: '\\bAKIA[0-9A-Z]{16}\\b' },
  // JWTs (header AND payload both start "eyJ" — base64 of '{"'; cuts false positives)
  { type: 'jwt', source: '\\beyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b' },
  // Authorization headers (real tokens are long; "Bearer tokens are…" stays)
  { type: 'bearer-token', source: '\\bBearer\\s+[A-Za-z0-9][A-Za-z0-9._~+/=-]{15,}' },
  // Generic sk-… API keys (OpenAI-style) — deliberately last
  { type: 'api-key', source: '\\bsk-[A-Za-z0-9_-]{20,}\\b' },
];

export interface SecretMatches {
  type: string;
  count: number;
}

function compile(rule: RedactionRule): RegExp {
  return new RegExp(rule.source, 'g');
}

/** Counts potential secrets per type WITHOUT modifying the text. */
export function findSecrets(text: string): SecretMatches[] {
  const matches: SecretMatches[] = [];
  for (const rule of REDACTION_RULES) {
    const count = (text.match(compile(rule)) ?? []).length;
    if (count > 0) matches.push({ type: rule.type, count });
  }
  return matches;
}

export interface RedactionResult {
  /** Text with every match replaced by `[REDACTED:<type>]`. */
  text: string;
  /** Matches per type, in rule order — only types with ≥ 1 match. */
  matches: SecretMatches[];
}

/** Replaces every potential secret with `[REDACTED:<type>]`. */
export function redactSecrets(text: string): RedactionResult {
  let out = text;
  const matches: SecretMatches[] = [];
  for (const rule of REDACTION_RULES) {
    const re = compile(rule);
    const hits = out.match(re) ?? [];
    if (hits.length > 0) {
      out = out.replace(re, `[REDACTED:${rule.type}]`);
      matches.push({ type: rule.type, count: hits.length });
    }
  }
  return { text: out, matches };
}

/** "2 github-token, 1 jwt" — for stderr lines and warnings. */
export function describeMatches(matches: SecretMatches[]): string {
  return matches.map((m) => `${m.count} ${m.type}`).join(', ');
}
