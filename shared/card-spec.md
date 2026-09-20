---
CARD_SPEC_VERSION: 1
---

# Context card specification

The card format is a **versioned contract** shared by the macOS app and the
CLI. `CARD_SPEC_VERSION` appears here and in `shared/extraction-prompt.md`
front matter (`spec_version`); the two must always match. Bump it only for
breaking card-format changes, in a PR that updates both implementations
(the drift check enforces this).

## Format

A card is a markdown document with:

1. A **`Captured on: YYYY-MM-DD`** line, generated locally by the tool
   (never by the model), ISO 8601 local date.
2. Six sections, in this exact order, each a level-2 (`##`) heading:

   | # | Section | Notes |
   |---|---|---|
   | 1 | `## Goal` | |
   | 2 | `## Key Decisions` | |
   | 3 | `## Constraints & Preferences` | |
   | 4 | `## Current State` | |
   | 5 | `## Resources & Links` | URLs/paths/IDs copied **verbatim** |
   | 6 | `## Open Questions` | |

3. Bullet points (`-`) as content; a section with nothing to report
   contains exactly `None noted.`

No preamble, no closing remarks, no wrapping code fences, no extra
headings.

## Compression levels

| Level | Prompt rule | Hard validation |
|---|---|---|
| `full` | preserve maximal detail | — |
| `balanced` (default) | drop filler, keep every decision/constraint/question/link | — |
| `minimal` | ≤ 2 short bullets per section | `LEVEL_LIMIT` if any section (except Resources & Links) exceeds 2 bullets |

## Validation reason codes

Both implementations must accept/reject identically on the shared fixtures.

| Code | Severity | Rule |
|---|---|---|
| `MISSING_SECTION` | fail | A required section is absent or out of spec order |
| `EMPTY_SECTION` | fail | A section has no content (`None noted.` counts as content) |
| `FABRICATED_URL` | fail | A URL in Resources & Links does not appear verbatim in the (redacted) input |
| `LEVEL_LIMIT` | fail | `minimal` level: more than 2 bullets in a non-exempt section |
| `NO_COMPRESSION` | warning | Card is not smaller than the input (skipped for very short inputs) |

On any failing code: retry the model **once** with the `retry` block
appended and `{{REASONS}}` filled in, at temperature 0. If it still fails,
print the card, warn on stderr, exit 5 — never silently pass a malformed
card.
