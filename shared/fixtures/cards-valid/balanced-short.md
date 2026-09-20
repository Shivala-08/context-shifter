---
input: transcripts/short.txt
level: balanced
---

Captured on: 2026-09-20

## Goal
- Migrate a ~180-post WordPress blog to Astro.

## Key Decisions
- Staged migration: WordPress export → JSON intermediate → MDX, with a redirect map for changed slugs.
- Importer is Node, outputs JSON first, then MDX; no WP-CLI/PHP anywhere.

## Constraints & Preferences
- No PHP or WP-CLI tooling.
- Permalink structure /%year%/%postname%/ must be preserved to avoid 404s; keep sitemap.xml identical.

## Current State
- Plan agreed; importer design settled (JSON intermediate → MDX).
- Open issue remains: whether draft posts are migrated as drafts or dropped.

## Resources & Links
- https://docs.astro.build/en/guides/content-collections/
- https://giscus.app
- https://github.com/akheron/wordpress-export-to-markdown

## Open Questions
- Draft posts: migrate as drafts or drop them?
