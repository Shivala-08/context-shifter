---
input: transcripts/short.txt
level: minimal
reason: LEVEL_LIMIT
---

Captured on: 2026-09-20

## Goal
- Migrate a ~180-post WordPress blog to Astro.
- Keep all 180 posts, the permalink structure, and the sitemap identical.
- Node importer that emits JSON first, then MDX.

## Key Decisions
- Staged migration: WordPress export → JSON intermediate → MDX.

## Constraints & Preferences
- No PHP or WP-CLI tooling.

## Current State
- Plan agreed.

## Resources & Links
- https://docs.astro.build/en/guides/content-collections/

## Open Questions
- Draft posts: migrate or drop?
