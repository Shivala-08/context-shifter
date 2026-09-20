---
input: transcripts/short.txt
level: minimal
---

Captured on: 2026-09-20

## Goal
- Migrate a WordPress blog (~180 posts) to Astro.

## Key Decisions
- Staged migration: WordPress export → JSON → MDX.

## Constraints & Preferences
- No PHP/WP-CLI; keep the /%year%/%postname%/ permalink structure.

## Current State
- Plan agreed, importer to be written in Node.

## Resources & Links
- https://docs.astro.build/en/guides/content-collections/
- https://giscus.app
- https://github.com/akheron/wordpress-export-to-markdown

## Open Questions
- Draft posts: migrate or drop?
