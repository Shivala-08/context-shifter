---
input: transcripts/messy.txt
level: balanced
---

Captured on: 2026-09-20

## Goal
- Rewrite the cache layer with TTLs and bounded memory.

## Key Decisions
- Redis with a 15-minute TTL for hot documents, read-through pattern, no write-behind.
- Keep the in-process LRU (10k entries) as layer one; stale-while-revalidate window is 30 seconds.

## Constraints & Preferences
- Write-behind rejected as too risky for now.

## Current State
- Migration script and RFC published; old memcached tier being decommissioned, no migration needed, just delete the feature flag after cutover.

## Resources & Links
- https://gitlab.internal.example.com/platform/cache-migration
- https://wiki.internal.example.com/rfc/cache-layer-v2
- https://grafana.internal.example.com/d/cache/overview

## Open Questions
- Shard by tenant or by document id?
- Do the metrics dashboards need a new hit-ratio-per-layer panel?
