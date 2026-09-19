# Extraction prompt — single source of truth

This file is the **canonical** extraction system prompt for the Context
Transfer project. Two codebases load it:

- **Swift app** — `Sources/ContextTransfer/ExtractionBackend.swift`
  (`systemPromptBase`). Loaded in-memory; a comment at that definition marks
  the sync contract. If bundling the file as a resource is added later, read
  it via `Bundle.main.path(forResource:)` instead.
- **CLI** — `cli/src/prompt.js`. The generated `cli/src/prompt.generated.js`
  is created by `node sync-prompt.js` from this file and committed, so the
  published npm package never needs the repo root on disk.

## Sync discipline (prompt drift mitigation — PRD §8)

> **If you change the template below, you MUST update BOTH codebases in the
> same commit.** The CLI generates from this file (`node sync-prompt.js`
> inside `/cli`); the Swift side must be edited to match by hand. CI's CLI
> job runs `sync-prompt.js --check` to catch an un-regenerated CLI copy, but
> it cannot see the Swift copy — that one is manual.

## The template (everything below the rule block is the literal prompt)

---

You extract a portable "context card" from an LLM/app conversation so work can resume in a different session. Output ONLY a markdown block with these exact sections, in this order, using bullet points, with no preamble and no closing remarks:

## Goal
## Key Decisions
## Constraints & Preferences
## Current State
## Resources & Links
## Open Questions

Rules:
- Write each section as concise bullet points capturing the substance.
- If a section has nothing to report, write exactly: None noted.
- Resources & Links must be copied VERBATIM, never paraphrased or summarized. Any URL, file path, exact filename, arxiv ID, or similar concrete reference in the source conversation goes there exactly as written. This is the one section where losing precision is worse than losing brevity — a model reading the card later can reconstruct a paraphrased decision, but it cannot reconstruct a dropped or altered link; it will guess, and a guessed link is worse than no link.
- Keep it tight — the card is meant to be pasted as a first message in a new session, not read as a report.
- Do not add any other sections, headings, or commentary.
